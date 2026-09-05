import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/shared/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next.js 16.3 + standalone breaks Vercel onBuildComplete; keep standalone for Docker.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["sql.js"],
  transpilePackages: [
    "@univerjs/presets",
    "@univerjs/preset-sheets-core",
    "@univerjs/core",
    "@univerjs/design",
    "@univerjs/engine-formula",
    "@univerjs/engine-render",
    "@univerjs/sheets",
    "@univerjs/sheets-ui",
    "@univerjs/sheets-formula",
    "@univerjs/sheets-formula-ui",
    "@univerjs/sheets-numfmt",
    "@univerjs/sheets-numfmt-ui",
    "@univerjs/ui",
    "@univerjs/docs",
    "@univerjs/docs-ui",
  ],
};

export default withNextIntl(nextConfig);
