import { PrismaClient } from "@prisma/client";
import { PRODUCT_CATALOG } from "./product-catalog-data";

const prisma = new PrismaClient();

function mode(): "dry-run" | "commit" {
  const commit = process.argv.includes("--commit");
  const dryRun = process.argv.includes("--dry-run");
  if (commit === dryRun) {
    throw new Error("Použite presne jeden prepínač: --dry-run alebo --commit.");
  }
  return commit ? "commit" : "dry-run";
}

async function main() {
  const selectedMode = mode();
  const existing = await prisma.product.findMany({
    where: { sku: { in: PRODUCT_CATALOG.map((product) => product.sku) } },
    select: { sku: true, priceB2bCents: true },
  });
  const bySku = new Map(existing.map((product) => [product.sku, product]));

  console.log(`Režim: ${selectedMode}; položiek katalógu: ${PRODUCT_CATALOG.length}`);
  for (const product of PRODUCT_CATALOG) {
    const current = bySku.get(product.sku);
    console.log(`${current ? "UPDATE" : "CREATE"} ${product.sku} | ${product.name} | ${product.priceB2cCents} centov B2C`);
  }

  if (selectedMode === "dry-run") return;

  await prisma.$transaction(
    PRODUCT_CATALOG.map((product) => prisma.product.upsert({
      where: { sku: product.sku },
      create: {
        ...product,
        unit: "ks",
        priceB2bCents: null,
      },
      update: {
        name: product.name,
        volumeMl: product.volumeMl,
        unit: "ks",
        priceB2cCents: product.priceB2cCents,
        vatRate: product.vatRate,
        shelfLifeDays: product.shelfLifeDays,
        isActive: true,
        // Existujúcu legacy B2B cenu neprepisujeme. Nové produkty ju nemajú.
      },
    })),
  );

  console.log("Katalóg bol uložený. B2B ceny zostali prázdne alebo zachované z existujúcich dát.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
