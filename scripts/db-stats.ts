import "dotenv/config";
import { prisma } from "../src/shared/db/prisma";

async function main() {
  const [users, projects, scenes] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.scene.count(),
  ]);
  console.log(`Users: ${users}`);
  console.log(`Projects: ${projects}`);
  console.log(`Scenes: ${scenes}`);

  if (users > 0) {
    const list = await prisma.user.findMany({
      select: { email: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    console.log("\nUsers:");
    for (const u of list) {
      console.log(`  ${u.email} (${u.name})`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
