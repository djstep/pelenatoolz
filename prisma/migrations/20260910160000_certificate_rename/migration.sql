-- Rename Act → Certificate and add paymentId
ALTER TABLE "Act" RENAME TO "Certificate";
ALTER TABLE "ActFile" RENAME TO "CertificateFile";
ALTER TABLE "CertificateFile" RENAME COLUMN "actId" TO "certificateId";

ALTER TABLE "Certificate" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;
ALTER TABLE "CertificateFile" ADD COLUMN IF NOT EXISTS "role" "ContractFileRole" NOT NULL DEFAULT 'OTHER';

-- Drop old FKs / indexes that reference old names (Postgres renames table but constraint names may stay)
ALTER INDEX IF EXISTS "Act_projectId_date_idx" RENAME TO "Certificate_projectId_date_idx";
ALTER INDEX IF EXISTS "Act_projectId_counterpartyId_idx" RENAME TO "Certificate_projectId_counterpartyId_idx";
ALTER INDEX IF EXISTS "Act_projectId_contractId_idx" RENAME TO "Certificate_projectId_contractId_idx";
ALTER INDEX IF EXISTS "Act_projectId_statusId_idx" RENAME TO "Certificate_projectId_statusId_idx";
ALTER INDEX IF EXISTS "Act_pkey" RENAME TO "Certificate_pkey";

ALTER INDEX IF EXISTS "ActFile_actId_fileId_key" RENAME TO "CertificateFile_certificateId_fileId_key";
ALTER INDEX IF EXISTS "ActFile_fileId_idx" RENAME TO "CertificateFile_fileId_idx";
ALTER INDEX IF EXISTS "ActFile_pkey" RENAME TO "CertificateFile_pkey";

CREATE INDEX IF NOT EXISTS "Certificate_projectId_paymentId_idx" ON "Certificate"("projectId", "paymentId");

-- Recreate payment FK
ALTER TABLE "Certificate" DROP CONSTRAINT IF EXISTS "Act_paymentId_fkey";
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CashPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rename FK constraint names where possible (ignore if already renamed)
DO $$ BEGIN
  ALTER TABLE "Certificate" RENAME CONSTRAINT "Act_projectId_fkey" TO "Certificate_projectId_fkey";
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Certificate" RENAME CONSTRAINT "Act_companyId_fkey" TO "Certificate_companyId_fkey";
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Certificate" RENAME CONSTRAINT "Act_counterpartyId_fkey" TO "Certificate_counterpartyId_fkey";
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Certificate" RENAME CONSTRAINT "Act_contractId_fkey" TO "Certificate_contractId_fkey";
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Certificate" RENAME CONSTRAINT "Act_statusId_fkey" TO "Certificate_statusId_fkey";
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CertificateFile" RENAME CONSTRAINT "ActFile_actId_fkey" TO "CertificateFile_certificateId_fkey";
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CertificateFile" RENAME CONSTRAINT "ActFile_fileId_fkey" TO "CertificateFile_fileId_fkey";
EXCEPTION WHEN others THEN NULL; END $$;
