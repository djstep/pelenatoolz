-- Per-shift resource call timings (arrival + ready + wrap)
ALTER TABLE "ShootDayResourceUsage" ADD COLUMN "readyTime" TEXT;
ALTER TABLE "ShootDayResourceUsage" ADD COLUMN "wrapTime" TEXT;
