import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export interface SessionData {
  userId?: string;
  name?: string;
  email?: string;
  role?: string;
}

export interface AuthenticatedUser {
  userId: string;
  name: string;
  email: string;
  role: string;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32 && !secret.includes("change-in-production")) return secret;
  if (process.env.NODE_ENV !== "production") return "zdravyshot-dev-secret-change-in-production-32ch";
  throw new Error("SESSION_SECRET musí byť v produkcii nastavený na náhodnú hodnotu s aspoň 32 znakmi.");
}

export const sessionOptions: SessionOptions = {
  password: getSessionSecret(),
  cookieName: "zs_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Vráti aktuálneho databázového používateľa. Rola a identita zo session sa
 * nepoužívajú na autorizáciu, aby sa zmena roly alebo zmazanie účtu prejavili
 * okamžite bez čakania na odhlásenie.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await getSession();
  if (!session.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) return null;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

/** Použiť na začiatku každej server action a chránenej stránky. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
