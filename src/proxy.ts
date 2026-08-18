import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/financie/einvoice/webhook",
]);

// Rýchla kontrola prítomnosti session cookie — skutočné overenie robí
// requireUser() v (app)/layout.tsx a v server actions.
export function proxy(request: NextRequest) {
  // eFaktúra webhook nemá používateľskú session; chráni ho povinný HMAC podpis
  // priamo v route handleri. Povolený je iba presný endpoint, nie celý prefix.
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const hasSession = request.cookies.has("zs_session");
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Všetko okrem loginu, externých API a statických súborov
    "/((?!login|api/health|api/inbox|api/konkurencia|api/cron|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)",
  ],
};
