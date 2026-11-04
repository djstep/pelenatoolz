-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");
