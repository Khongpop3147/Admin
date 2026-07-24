import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

let prisma: PrismaClient;

if (globalForPrisma.prisma) {
  prisma = globalForPrisma.prisma;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      customerName, platform, crispyPorkPiece, crispyPorkWeight, packedPork, promotion, price, 
      shippingMethod, additionalShippingCost, additionalFoamBoxCost, actualReceivedAmount, 
      transferSlip, paymentStatus, customerAddress, orderStatus, rackDetails, sellerName, trackingNumber,
      bypassDuplicateCheck
    } = body;

    if (!customerName) {
      return NextResponse.json(
        { error: "Customer Name is required." },
        { status: 400 }
      );
    }

    if (!bypassDuplicateCheck) {
      // Check for duplicate customer name (Alert if admin types same name)
      const existingOrder = await prisma.order.findFirst({
        where: {
          customerName: {
            equals: customerName,
          }
        },
      });

      if (existingOrder) {
        return NextResponse.json(
          {
            duplicate: true,
            message: `Warning: Customer "${customerName}" already exists in the system.`,
          },
          { status: 200 }
        );
      }
    }

    let parsedRackDetails: any[] = [];
    if (rackDetails) {
      try {
        parsedRackDetails = JSON.parse(rackDetails);
      } catch(e) { }
    }

    // Save the order and deduct rack weights in a transaction
    const newOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          customerName,
          platform,
          crispyPorkPiece,
          crispyPorkWeight,
          packedPork,
          promotion,
          price: price ? parseFloat(price) : null,
          shippingMethod,
          additionalShippingCost: additionalShippingCost ? parseFloat(additionalShippingCost) : null,
          additionalFoamBoxCost: additionalFoamBoxCost ? parseFloat(additionalFoamBoxCost) : null,
          actualReceivedAmount: actualReceivedAmount ? parseFloat(actualReceivedAmount) : null,
          transferSlip,
          paymentStatus,
          customerAddress,
          orderStatus,
          rackDetails, // Store the JSON string directly
          sellerName,
          trackingNumber,
        },
      });

      // Deduct weight from assigned racks
      for (const rack of parsedRackDetails) {
        if (!rack.assignmentId || !rack.weight) continue;
        
        const currentRack = await tx.rackAssignment.findUnique({ where: { id: rack.assignmentId }});
        if (!currentRack) throw new Error("Rack not found");
        
        const newWeight = currentRack.remainingWeight - parseFloat(rack.weight);
        if (newWeight < 0) throw new Error(`Rack ${currentRack.rackNo} does not have enough remaining weight (has ${currentRack.remainingWeight}kg, tried to use ${rack.weight}kg).`);

        await tx.rackAssignment.update({
          where: { id: rack.assignmentId },
          data: {
            remainingWeight: newWeight,
            isUsedUp: newWeight <= 0
          }
        });
      }

      return order;
    });

    return NextResponse.json({ success: true, order: newOrder }, { status: 201 });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sellerName = searchParams.get("sellerName");
    
    const whereClause = sellerName ? { sellerName } : {};

    const orders = await prisma.order.findMany({
      where: whereClause,
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    });
    return NextResponse.json({ orders }, { status: 200 });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
