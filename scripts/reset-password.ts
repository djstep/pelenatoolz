import bcrypt from "bcryptjs";
import { prisma } from "../src/shared/db/prisma";

async function main() {
  const email = process.argv[2]?.toLowerCase();
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.log("Usage: npx tsx scripts/reset-password.ts <email> <new-password>");
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found: ${email}`);
    const users = await prisma.user.findMany({
      select: { email: true, name: true },
      orderBy: { createdAt: "desc" },
    });
    if (users.length > 0) {
      console.log("\nRegistered users:");
      for (const u of users) console.log(`  - ${u.email} (${u.name})`);
    }
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  console.log(`Password updated for ${email}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
