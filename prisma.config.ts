import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use direct Neon URL when set; fall back to DATABASE_URL for generate/install.
const databaseUrl =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: databaseUrl,
  },
});
