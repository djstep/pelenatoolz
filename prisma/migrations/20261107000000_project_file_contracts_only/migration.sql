-- Постоянный признак файла договора или акта: открепление не делает скан общим.
ALTER TABLE "ProjectFile" ADD COLUMN "contractsOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ProjectFile" AS f
SET "contractsOnly" = true
WHERE EXISTS (SELECT 1 FROM "ContractFile" AS c WHERE c."fileId" = f."id")
   OR EXISTS (SELECT 1 FROM "CertificateFile" AS c WHERE c."fileId" = f."id");
