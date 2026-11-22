import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { logout } from "@/app/(auth)/login/_actions";
import { hasFinancePermission } from "@/lib/finance/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
      <AppShell
        userName={user.name}
        canViewFinance={hasFinancePermission(user.role, "VIEW")}
        canConfigureFinance={hasFinancePermission(user.role, "CONFIGURE")}
        canCreateDraft={hasFinancePermission(user.role, "CREATE_DRAFT")}
        logoutAction={logout}
      >{children}</AppShell>
  );
}
