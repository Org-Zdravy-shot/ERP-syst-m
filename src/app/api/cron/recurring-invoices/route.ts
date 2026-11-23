import { generateDueRecurringDrafts } from "@/lib/finance/recurring/schedule";
import { configuredSecret, secretMatches } from "@/lib/security/secrets";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!configuredSecret(secret)) return Response.json({ status: "disabled" }, { status: 503 });
  if (!secretMatches(secret, request.headers.get("x-cron-secret"))) return Response.json({ status: "unauthorized" }, { status: 401 });
  const result = await generateDueRecurringDrafts();
  return Response.json(result, { status: result.failed ? 502 : 200 });
}
