-- ScoutCandidate: 1:1 locationId → M2M via ScoutCandidateLocation

CREATE TABLE "ScoutCandidateLocation" (
    "scoutCandidateId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "ScoutCandidateLocation_pkey" PRIMARY KEY ("scoutCandidateId","locationId")
);

INSERT INTO "ScoutCandidateLocation" ("scoutCandidateId", "locationId")
SELECT "id", "locationId" FROM "ScoutCandidate";

CREATE INDEX "ScoutCandidateLocation_locationId_idx" ON "ScoutCandidateLocation"("locationId");

ALTER TABLE "ScoutCandidateLocation" ADD CONSTRAINT "ScoutCandidateLocation_scoutCandidateId_fkey" FOREIGN KEY ("scoutCandidateId") REFERENCES "ScoutCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScoutCandidateLocation" ADD CONSTRAINT "ScoutCandidateLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScoutCandidate" DROP CONSTRAINT "ScoutCandidate_locationId_fkey";

DROP INDEX "ScoutCandidate_locationId_idx";

ALTER TABLE "ScoutCandidate" DROP COLUMN "locationId";
