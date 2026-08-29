import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/shared/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next.js 16.3 + standalone breaks Vercel onBuildComplete; keep standalone for Docker.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["sql.js"],
};

export default withNextIntl(nextConfig);
