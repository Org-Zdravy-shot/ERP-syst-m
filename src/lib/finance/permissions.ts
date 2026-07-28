export type FinancePermission =
  | "VIEW"
  | "CREATE_DRAFT"
  | "FINALIZE"
  | "CANCEL"
  | "CONFIGURE"
  | "ALLOCATE_PAYMENT"
  | "SEND_DOCUMENT"
  | "EXPORT";

const ALL_FINANCE_PERMISSIONS: readonly FinancePermission[] = [
  "VIEW",
  "CREATE_DRAFT",
  "FINALIZE",
  "CANCEL",
  "CONFIGURE",
  "ALLOCATE_PAYMENT",
  "SEND_DOCUMENT",
  "EXPORT",
];

const ROLE_PERMISSIONS: Record<string, readonly FinancePermission[]> = {
  admin: ALL_FINANCE_PERMISSIONS,
  FINANCE_ADMIN: ALL_FINANCE_PERMISSIONS,
  FINANCE_OPERATOR: [
    "VIEW",
    "CREATE_DRAFT",
    "ALLOCATE_PAYMENT",
    "SEND_DOCUMENT",
    "EXPORT",
  ],
};

export class FinanceAuthorizationError extends Error {
  constructor() {
    super("Na túto finančnú operáciu nemáte oprávnenie.");
    this.name = "FinanceAuthorizationError";
  }
}

export function hasFinancePermission(role: string | undefined, permission: FinancePermission): boolean {
  return !!role && (ROLE_PERMISSIONS[role]?.includes(permission) ?? false);
}

export async function requireFinancePermission(permission: FinancePermission) {
  const { requireUser } = await import("@/lib/auth");
  const user = await requireUser();
  if (!hasFinancePermission(user.role, permission)) throw new FinanceAuthorizationError();
  return user;
}
