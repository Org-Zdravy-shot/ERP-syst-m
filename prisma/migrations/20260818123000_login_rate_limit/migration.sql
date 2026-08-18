-- Perzistentný login rate limit. Identifikátor je HMAC; surový e-mail ani IP
-- adresa sa do databázy neukladajú.
CREATE TABLE "LoginRateLimit" (
    "keyHash" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginRateLimit_pkey" PRIMARY KEY ("keyHash"),
    CONSTRAINT "LoginRateLimit_failureCount_check" CHECK ("failureCount" >= 0)
);

CREATE INDEX "LoginRateLimit_expiresAt_idx"
    ON "LoginRateLimit"("expiresAt");
CREATE INDEX "LoginRateLimit_blockedUntil_idx"
    ON "LoginRateLimit"("blockedUntil");
