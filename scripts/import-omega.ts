import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  assertOmegaCommitSafety,
  commitOmegaImport,
  decodeOmegaExport,
  parseOmegaText,
} from "../src/lib/finance/import/omega";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printUsage(): never {
  console.error(
    [
      "Použitie:",
      "  npm run finance:omega -- <export.zip>",
      "  npm run finance:omega -- <export.zip> --commit --confirm-sha256=<sha> --backup-reference=<ref> --actor-id=<id>",
      "    [--actor-email=<email>] [--mark-issued-paid --issued-paid-date=due-date]",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const fileArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  if (!fileArgument) printUsage();
  const filePath = resolve(fileArgument);
  const bytes = readFileSync(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const decoded = decodeOmegaExport(bytes);
  const parsed = parseOmegaText(decoded.text);
  const preview = {
    mode: hasFlag("commit") ? "COMMIT_REQUESTED" : "DRY_RUN",
    fileName: basename(filePath),
    zipEntry: decoded.entryName,
    sha256,
    summary: parsed.summary,
    warnings: parsed.warnings,
    errors: parsed.errors,
  };
  console.log(JSON.stringify(preview, null, 2));

  if (parsed.errors.length > 0) {
    throw new Error("Dry-run zistil blokujúce chyby; commit sa nesmie spustiť.");
  }
  if (!hasFlag("commit")) return;

  const markIssuedPaid = hasFlag("mark-issued-paid");
  const issuedPaidDate = option("issued-paid-date");
  assertOmegaCommitSafety({
    actualSha256: sha256,
    confirmedSha256: option("confirm-sha256"),
    backupReference: option("backup-reference"),
    actorId: option("actor-id"),
    markIssuedPaid,
    issuedPaidDateStrategy: issuedPaidDate,
  });
  if (!process.env.DATABASE_URL) throw new Error("Pre commit chýba DATABASE_URL.");

  const result = await commitOmegaImport({
    parsed,
    fileName: basename(filePath),
    sha256,
    backupReference: option("backup-reference")!,
    actorId: option("actor-id")!,
    ...(option("actor-email") ? { actorEmail: option("actor-email") } : {}),
    markIssuedPaid,
    ...(issuedPaidDate === "due-date" ? { issuedPaidDateStrategy: "due-date" as const } : {}),
  });
  console.log(JSON.stringify({ committed: true, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
