import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { logout } from "@/app/(auth)/login/_actions";
import { hasFinancePermission } from "@/lib/finance/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 md:flex-row">
      <Sidebar
        userName={user.name}
        canViewFinance={hasFinancePermission(user.role, "VIEW")}
        logoutAction={logout}
      />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">{children}</main>
    </div>
  );
}
