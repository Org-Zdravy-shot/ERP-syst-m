"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { clientAddressFromHeaders } from "@/lib/auth/client-address";
import {
  checkLoginRateLimit,
  clearSuccessfulLogin,
  recordFailedLogin,
} from "@/lib/auth/login-rate-limit";

const DUMMY_PASSWORD_HASH =
  "$2b$12$rM9b/fnHdh/Wg23K0n8G9OCOfYZe32H9LWr5zlc/cXpdJVSWoTfry";

function rateLimitError(retryAfterSeconds: number): { error: string } {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    error: `Príliš veľa neúspešných pokusov. Skúste to znova približne o ${minutes} min.`,
  };
}

export async function login(_prevState: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Zadajte e-mail a heslo." };
  }

  const clientAddress = clientAddressFromHeaders(await headers());
  const identity = {
    email: email.slice(0, 320),
    clientAddress,
  };
  const limit = await checkLoginRateLimit(identity);
  if (limit.blocked) return rateLimitError(limit.retryAfterSeconds);

  const validInput = email.length <= 320 && password.length <= 1_024;
  const user = validInput
    ? await prisma.user.findUnique({ where: { email } })
    : null;
  const passwordMatches = await bcrypt.compare(
    validInput ? password : "invalid-login-input",
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !passwordMatches) {
    const failed = await recordFailedLogin(identity);
    if (failed.blocked) return rateLimitError(failed.retryAfterSeconds);
    return { error: "Nesprávny e-mail alebo heslo." };
  }

  await clearSuccessfulLogin(identity);

  const session = await getSession();
  session.userId = user.id;
  session.name = user.name;
  session.email = user.email;
  session.role = user.role;
  await session.save();

  redirect("/");
}

export async function logout() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
