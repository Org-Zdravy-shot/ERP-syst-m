const secret = process.env.CRON_SECRET;
if (!secret || secret.length < 32) throw new Error("Chýba CRON_SECRET.");

const endpoint = new URL("/api/cron/tax-register", process.env.ERP_BASE_URL);
if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
  throw new Error("ERP_BASE_URL musí byť HTTPS adresa ERP.");
}

const response = await fetch(endpoint, {
  method: "POST",
  redirect: "error",
  headers: { "x-cron-secret": secret },
  signal: AbortSignal.timeout(180_000),
});
if (!response.ok) throw new Error(`Obnova daňového registra zlyhala (HTTP ${response.status}).`);
const summary = await response.json();
if (summary.status !== "done") throw new Error("ERP nepotvrdilo obnovu daňového registra.");
console.log("Obnovené výpisy Finančnej správy:", summary.result);
