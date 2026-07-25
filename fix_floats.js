const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: 'postgresql://postgres:pensiri123@localhost:5432/Admin' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const racks = await prisma.rackAssignment.findMany();
  let updated = 0;
  for (const rack of racks) {
    const fixedWeight = parseFloat(rack.remainingWeight.toFixed(2));
    if (fixedWeight !== rack.remainingWeight) {
      await prisma.rackAssignment.update({
        where: { id: rack.id },
        data: { remainingWeight: fixedWeight }
      });
      updated++;
      console.log(`Updated rack ${rack.rackNo} from ${rack.remainingWeight} to ${fixedWeight}`);
    }
  }
  console.log(`Fixed ${updated} racks.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
