import { prisma } from "../src/shared/db/prisma";

const users = await prisma.user.findMany({
  select: { email: true, name: true, createdAt: true },
  orderBy: { createdAt: "desc" },
});

if (users.length === 0) {
  console.log("No users in database.");
} else {
  console.log("Registered users:\n");
  for (const u of users) {
    console.log(`  ${u.email}  —  ${u.name}  (${u.createdAt.toISOString().slice(0, 10)})`);
  }
}

await prisma.$disconnect();
