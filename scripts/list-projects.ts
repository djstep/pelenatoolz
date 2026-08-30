import { prisma } from "../src/shared/db/prisma";

async function main() {
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      createdBy: { select: { email: true, name: true } },
      memberships: {
        where: { status: "ACTIVE" },
        select: { user: { select: { email: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (projects.length === 0) {
    console.log("В базе нет проектов.");
  } else {
    console.log(`Проектов в базе: ${projects.length}\n`);
    for (const p of projects) {
      const members = p.memberships.map((m) => m.user.email).join(", ");
      console.log(`• ${p.name} [${p.status}]`);
      console.log(`  создатель: ${p.createdBy.email}`);
      console.log(`  участники: ${members}`);
      console.log(`  id: ${p.id}`);
      console.log("");
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
