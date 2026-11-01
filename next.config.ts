import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/shared/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next.js 16.3 + standalone breaks Vercel onBuildComplete; keep standalone for Docker.
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: ["sql.js"],
  // Файлы, которые выгрузки читают с диска (`fs`), — в сборку кладём явно, прямыми путями:
  // шрифт печатного листа вызывного; логотип явочного листа (вызывной и отчёт смены).
  outputFileTracingIncludes: {
    "/*/projects/*/call-sheets/**": [
      "./node_modules/medeo-font/dist/fonts/medeo-sans/MedeoSansVariable.woff2",
      "./public/brand/pelena-black.png",
    ],
    "/*/projects/*/reports/**": ["./public/brand/pelena-black.png"],
    "/api/fonts/**": ["./node_modules/medeo-font/dist/fonts/medeo-sans/MedeoSansVariable.woff2"],
  },
  // Только для `next dev`: второй и третий аккаунты открываются на 127.0.0.1 и 127.0.0.2
  // (отдельные куки входа).
  allowedDevOrigins: ["127.0.0.1", "127.0.0.2"],
  experimental: {
    serverActions: {
      // Смета больше 1 МБ и импорт Excel (раздел 6 аудита). Не выше 4,5 МБ — потолок
      // тела запроса у Vercel.
      bodySizeLimit: "4mb",
    },
  },
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
