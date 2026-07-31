import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = global as unknown as { prisma2: PrismaClient };
let prisma: PrismaClient;

if (globalForPrisma.prisma2) {
  prisma = globalForPrisma.prisma2;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma2 = prisma;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const { id } = resolvedParams;
    const body = await req.json();
    
    // Allow updating orderStatus, trackingNumber, or adminNote
    const updateData: any = {};
    if (body.orderStatus !== undefined) updateData.orderStatus = body.orderStatus;
    if (body.trackingNumber !== undefined) updateData.trackingNumber = body.trackingNumber;
    if (body.adminNote !== undefined) updateData.adminNote = body.adminNote;
    if (body.customerName !== undefined) updateData.customerName = body.customerName;
    if (body.customerAddress !== undefined) updateData.customerAddress = body.customerAddress;
    if (body.crispyPorkPiece !== undefined) updateData.crispyPorkPiece = body.crispyPorkPiece;
    if (body.crispyPorkWeight !== undefined) updateData.crispyPorkWeight = body.crispyPorkWeight;
    if (body.codAmount !== undefined) updateData.codAmount = Number(body.codAmount) || 0;
    if (body.price !== undefined) updateData.price = Number(body.price) || 0;
    if (body.paymentStatus !== undefined) updateData.paymentStatus = body.paymentStatus;
    if (body.transferSlip !== undefined) updateData.transferSlip = body.transferSlip;
    if (body.isReturned !== undefined) updateData.isReturned = !!body.isReturned;

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, order: updatedOrder }, { status: 200 });
  } catch (error: any) {
    console.error("Error updating order:", error);
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "ไม่พบออเดอร์นี้ อาจถูกลบไปแล้ว" }, { status: 404 });
    }
    return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
