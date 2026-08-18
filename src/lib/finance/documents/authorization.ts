import { getCurrentUser } from "@/lib/auth";
import type { FinancePermission } from "@/lib/finance/permissions";
import { hasFinancePermission } from "@/lib/finance/permissions";
import {
  DocumentAccessError,
  DocumentAuthenticationError,
} from "./errors";

export async function requireFinanceDocumentUser(permission: FinancePermission) {
  const currentUser = await getCurrentUser();
  const user = currentUser
    ? {
        id: currentUser.userId,
        email: currentUser.email,
        name: currentUser.name,
        role: currentUser.role,
      }
    : null;
  if (!user) throw new DocumentAuthenticationError();
  if (!hasFinancePermission(user.role, permission)) {
    throw new DocumentAccessError();
  }
  return user;
}
