import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type LoginRateLimitScope = "IDENTITY_IP" | "IP";

export interface LoginRateLimitPolicy {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
}

export const LOGIN_RATE_LIMIT_POLICIES: Record<
  LoginRateLimitScope,
  LoginRateLimitPolicy
> = {
  IDENTITY_IP: {
    maxFailures: 5,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  IP: {
    maxFailures: 25,
    windowMs: 15 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
};

interface RateLimitIdentity {
  email: string;
  clientAddress: string;
}

interface RateLimitRecord {
  failureCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
  expiresAt: Date;
}

interface RateLimitTarget {
  keyHash: string;
  scope: LoginRateLimitScope;
  policy: LoginRateLimitPolicy;
}

export interface LoginRateLimitStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

export interface NextFailureState extends RateLimitRecord {
  becameBlocked: boolean;
}

function rateLimitSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.LOGIN_RATE_LIMIT_SECRET?.trim() || env.SESSION_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  if (env.NODE_ENV !== "production") {
    return "zdravyshot-dev-login-rate-limit-secret-32";
  }
  throw new Error(
    "LOGIN_RATE_LIMIT_SECRET alebo SESSION_SECRET musí mať aspoň 32 znakov.",
  );
}

function keyHash(
  scope: LoginRateLimitScope,
  value: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`zdravyshot-login-rate-limit\0${scope}\0${value}`)
    .digest("hex");
}

export function loginRateLimitTargets(
  identity: RateLimitIdentity,
  secret = rateLimitSecret(),
): RateLimitTarget[] {
  const email = identity.email.trim().toLowerCase();
  const address = identity.clientAddress.trim().toLowerCase() || "unknown";
  const targets: RateLimitTarget[] = [
    {
      scope: "IDENTITY_IP",
      keyHash: keyHash("IDENTITY_IP", `${email}\0${address}`, secret),
      policy: LOGIN_RATE_LIMIT_POLICIES.IDENTITY_IP,
    },
  ];
  if (address !== "unknown") {
    targets.push({
      scope: "IP",
      keyHash: keyHash("IP", address, secret),
      policy: LOGIN_RATE_LIMIT_POLICIES.IP,
    });
  }
  return targets;
}

export function nextLoginFailureState(
  current: RateLimitRecord,
  policy: LoginRateLimitPolicy,
  now: Date,
): NextFailureState {
  const windowExpired =
    current.expiresAt.getTime() <= now.getTime() &&
    (!current.blockedUntil || current.blockedUntil.getTime() <= now.getTime());
  const failureCount = windowExpired ? 1 : current.failureCount + 1;
  const windowStartedAt = windowExpired ? now : current.windowStartedAt;
  let expiresAt = windowExpired
    ? new Date(now.getTime() + policy.windowMs)
    : current.expiresAt;
  const wasBlocked =
    current.blockedUntil !== null &&
    current.blockedUntil.getTime() > now.getTime();
  let blockedUntil = wasBlocked ? current.blockedUntil : null;
  if (failureCount >= policy.maxFailures) {
    const candidate = new Date(now.getTime() + policy.blockMs);
    if (!blockedUntil || blockedUntil.getTime() < candidate.getTime()) {
      blockedUntil = candidate;
    }
    if (expiresAt.getTime() < blockedUntil.getTime()) {
      expiresAt = blockedUntil;
    }
  }

  return {
    failureCount,
    windowStartedAt,
    blockedUntil,
    expiresAt,
    becameBlocked: !wasBlocked && blockedUntil !== null,
  };
}

function statusFromBlockedUntil(
  blockedUntil: Array<Date | null>,
  now: Date,
): LoginRateLimitStatus {
  const latest = blockedUntil.reduce<Date | null>((current, value) => {
    if (!value || value.getTime() <= now.getTime()) return current;
    if (!current || value.getTime() > current.getTime()) return value;
    return current;
  }, null);
  return latest
    ? {
        blocked: true,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((latest.getTime() - now.getTime()) / 1000),
        ),
      }
    : { blocked: false, retryAfterSeconds: 0 };
}

export async function checkLoginRateLimit(
  identity: RateLimitIdentity,
  now = new Date(),
): Promise<LoginRateLimitStatus> {
  const targets = loginRateLimitTargets(identity);
  const records = await prisma.loginRateLimit.findMany({
    where: { keyHash: { in: targets.map((target) => target.keyHash) } },
    select: { blockedUntil: true },
  });
  return statusFromBlockedUntil(
    records.map((record) => record.blockedUntil),
    now,
  );
}

async function updateTargetAfterFailure(
  tx: Prisma.TransactionClient,
  target: RateLimitTarget,
  now: Date,
): Promise<Date | null> {
  await tx.loginRateLimit.upsert({
    where: { keyHash: target.keyHash },
    create: {
      keyHash: target.keyHash,
      failureCount: 0,
      windowStartedAt: now,
      expiresAt: now,
    },
    update: { updatedAt: now },
  });
  const current = await tx.loginRateLimit.findUniqueOrThrow({
    where: { keyHash: target.keyHash },
  });
  const next = nextLoginFailureState(current, target.policy, now);
  await tx.loginRateLimit.update({
    where: { keyHash: target.keyHash },
    data: {
      failureCount: next.failureCount,
      windowStartedAt: next.windowStartedAt,
      blockedUntil: next.blockedUntil,
      expiresAt: next.expiresAt,
    },
  });
  if (next.becameBlocked && next.blockedUntil) {
    await tx.auditLog.create({
      data: {
        action: "LOGIN_RATE_LIMIT_TRIGGERED",
        entityType: "LoginRateLimit",
        entityId: target.keyHash,
        metadata: {
          scope: target.scope,
          failureCount: next.failureCount,
          blockedUntil: next.blockedUntil.toISOString(),
          windowSeconds: Math.round(target.policy.windowMs / 1000),
        },
      },
    });
  }
  return next.blockedUntil;
}

export async function recordFailedLogin(
  identity: RateLimitIdentity,
  now = new Date(),
): Promise<LoginRateLimitStatus> {
  const targets = loginRateLimitTargets(identity);
  return prisma.$transaction(async (tx) => {
    const blockedUntil: Array<Date | null> = [];
    for (const target of targets) {
      blockedUntil.push(await updateTargetAfterFailure(tx, target, now));
    }
    await tx.loginRateLimit.deleteMany({
      where: {
        keyHash: { notIn: targets.map((target) => target.keyHash) },
        expiresAt: { lt: now },
        OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }],
      },
    });
    return statusFromBlockedUntil(blockedUntil, now);
  });
}

export async function clearSuccessfulLogin(
  identity: RateLimitIdentity,
  now = new Date(),
): Promise<void> {
  const identityTarget = loginRateLimitTargets(identity).find(
    (target) => target.scope === "IDENTITY_IP",
  )!;
  await prisma.$transaction(async (tx) => {
    await tx.loginRateLimit.deleteMany({
      where: { keyHash: identityTarget.keyHash },
    });
    await tx.loginRateLimit.deleteMany({
      where: {
        expiresAt: { lt: now },
        OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }],
      },
    });
  });
}
