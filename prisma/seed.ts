/* eslint-disable no-console */
// Demo dáta pre vývoj a testovanie všetkých modulov.
// Spustenie: npx prisma db seed

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // ---------- Používatelia ----------
  const passwordHash = await bcrypt.hash("zdravyshot123", 10);
  await prisma.user.createMany({
    data: [
      { email: "admin@zdravyshot.sk", name: "Admin", passwordHash, role: "admin" },
      { email: "katka@zdravyshot.sk", name: "Katka (výroba)", passwordHash, role: "user" },
      { email: "miro@zdravyshot.sk", name: "Miro (obchod)", passwordHash, role: "user" },
    ],
  });

  // ---------- Produkty ----------
  const zazvor60 = await prisma.product.create({
    data: { sku: "ZS-060", name: "Zázvorový shot 60ml", volumeMl: 60, priceB2cCents: 250, priceB2bCents: 180, minStock: 100, shelfLifeDays: 21 },
  });
  const kurkuma60 = await prisma.product.create({
    data: { sku: "KS-060", name: "Kurkumový shot 60ml", volumeMl: 60, priceB2cCents: 270, priceB2bCents: 195, minStock: 80, shelfLifeDays: 21 },
  });
  const jablko100 = await prisma.product.create({
    data: { sku: "ZJ-100", name: "Zázvor-jablko shot 100ml", volumeMl: 100, priceB2cCents: 320, priceB2bCents: 240, minStock: 50, shelfLifeDays: 14 },
  });
  const imunity60 = await prisma.product.create({
    data: { sku: "IM-060", name: "Imunity mix 60ml", volumeMl: 60, priceB2cCents: 290, priceB2bCents: 210, minStock: 50, shelfLifeDays: 21 },
  });
  await prisma.product.create({
    data: { sku: "BAL-7Z", name: "Balíček 7× zázvorový shot", volumeMl: 420, priceB2cCents: 1490, priceB2bCents: 1100, minStock: 20, shelfLifeDays: 21 },
  });

  // ---------- Suroviny ----------
  const zazvor = await prisma.material.create({ data: { name: "Zázvor čerstvý", unit: "kg", minStock: 5, lastPriceCents: 450 } });
  const kurkuma = await prisma.material.create({ data: { name: "Kurkuma čerstvá", unit: "kg", minStock: 2, lastPriceCents: 890 } });
  const jablkovaStava = await prisma.material.create({ data: { name: "Jablková šťava", unit: "l", minStock: 20, lastPriceCents: 120 } });
  const citronovaStava = await prisma.material.create({ data: { name: "Citrónová šťava", unit: "l", minStock: 10, lastPriceCents: 380 } });
  const med = await prisma.material.create({ data: { name: "Med", unit: "kg", minStock: 3, lastPriceCents: 950 } });
  const korenie = await prisma.material.create({ data: { name: "Čierne korenie", unit: "kg", minStock: 0.5, lastPriceCents: 1500 } });
  const flaska60 = await prisma.material.create({ data: { name: "Fľaška 60ml", unit: "ks", kind: "PACKAGING", minStock: 500, lastPriceCents: 18 } });
  const flaska100 = await prisma.material.create({ data: { name: "Fľaška 100ml", unit: "ks", kind: "PACKAGING", minStock: 300, lastPriceCents: 24 } });
  const etiketa = await prisma.material.create({ data: { name: "Etiketa", unit: "ks", kind: "PACKAGING", minStock: 1000, lastPriceCents: 5 } });
  const vrchnak = await prisma.material.create({ data: { name: "Vrchnák", unit: "ks", kind: "PACKAGING", minStock: 1000, lastPriceCents: 4 } });

  // ---------- Receptúry (na 100 ks) ----------
  await prisma.recipe.create({
    data: {
      productId: zazvor60.id,
      batchSize: 100,
      items: {
        create: [
          { materialId: zazvor.id, quantity: 1.2 },
          { materialId: jablkovaStava.id, quantity: 3.5 },
          { materialId: citronovaStava.id, quantity: 1.5 },
          { materialId: flaska60.id, quantity: 100 },
          { materialId: etiketa.id, quantity: 100 },
          { materialId: vrchnak.id, quantity: 100 },
        ],
      },
    },
  });
  await prisma.recipe.create({
    data: {
      productId: kurkuma60.id,
      batchSize: 100,
      items: {
        create: [
          { materialId: kurkuma.id, quantity: 0.8 },
          { materialId: zazvor.id, quantity: 0.4 },
          { materialId: jablkovaStava.id, quantity: 3.8 },
          { materialId: citronovaStava.id, quantity: 1.2 },
          { materialId: korenie.id, quantity: 0.02 },
          { materialId: flaska60.id, quantity: 100 },
          { materialId: etiketa.id, quantity: 100 },
          { materialId: vrchnak.id, quantity: 100 },
        ],
      },
    },
  });
  await prisma.recipe.create({
    data: {
      productId: jablko100.id,
      batchSize: 100,
      items: {
        create: [
          { materialId: zazvor.id, quantity: 1.0 },
          { materialId: jablkovaStava.id, quantity: 7.5 },
          { materialId: citronovaStava.id, quantity: 1.0 },
          { materialId: flaska100.id, quantity: 100 },
          { materialId: etiketa.id, quantity: 100 },
          { materialId: vrchnak.id, quantity: 100 },
        ],
      },
    },
  });
  await prisma.recipe.create({
    data: {
      productId: imunity60.id,
      batchSize: 100,
      items: {
        create: [
          { materialId: zazvor.id, quantity: 0.8 },
          { materialId: kurkuma.id, quantity: 0.4 },
          { materialId: med.id, quantity: 0.6 },
          { materialId: citronovaStava.id, quantity: 2.0 },
          { materialId: jablkovaStava.id, quantity: 2.5 },
          { materialId: flaska60.id, quantity: 100 },
          { materialId: etiketa.id, quantity: 100 },
          { materialId: vrchnak.id, quantity: 100 },
        ],
      },
    },
  });

  // ---------- Klienti ----------
  const fitko = await prisma.client.create({
    data: {
      type: "B2B", name: "Fitko Havran s.r.o.", ico: "52123456", dic: "2121234567", icDph: "SK2121234567",
      email: "objednavky@fitkohavran.sk", phone: "+421 905 111 222",
      street: "Športová 12", city: "Bratislava", zip: "82105",
    },
  });
  const klasok = await prisma.client.create({
    data: {
      type: "B2B", name: "Bio obchod Klások", ico: "47987654", dic: "2023987654",
      email: "info@klasok.sk", street: "Hlavná 45", city: "Trnava", zip: "91701",
    },
  });
  const kaviaren = await prisma.client.create({
    data: {
      type: "B2B", name: "Kaviareň Puknutá šálka", ico: "51555333",
      email: "ahoj@puknutasalka.sk", city: "Bratislava",
    },
  });
  const jana = await prisma.client.create({
    data: { type: "B2C", name: "Jana Nováková", email: "jana.novakova@gmail.com", phone: "+421 907 333 444", city: "Pezinok" },
  });
  await prisma.client.create({
    data: { type: "B2C", name: "Peter Horváth", email: "peter.horvath@azet.sk", city: "Senec" },
  });

  // ---------- Počiatočné príjmy surovín ----------
  const materialsIntake: Array<[string, number, number]> = [
    [zazvor.id, 15, 450], [kurkuma.id, 5, 890], [jablkovaStava.id, 60, 120],
    [citronovaStava.id, 25, 380], [med.id, 8, 950], [korenie.id, 1, 1500],
    [flaska60.id, 2000, 18], [flaska100.id, 800, 24], [etiketa.id, 5000, 5], [vrchnak.id, 3000, 4],
  ];
  for (const [materialId, quantity, unitPriceCents] of materialsIntake) {
    await prisma.stockMovement.create({
      data: { type: "PRIJEM", materialId, quantity, unitPriceCents, note: "Počiatočný stav" },
    });
  }

  // ---------- Výrobné šarže (hotové, so spotrebou a produkciou) ----------
  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getTime() - n * 24 * 3600 * 1000);
  const daysAhead = (n: number) => new Date(today.getTime() + n * 24 * 3600 * 1000);

  const batch1 = await prisma.productionBatch.create({
    data: {
      batchNumber: "S2026-0001", productId: zazvor60.id, producedQty: 200,
      productionDate: daysAgo(10), expiryDate: daysAhead(11), status: "DONE",
    },
  });
  // spotreba podľa receptúry ×2 (200 ks / batchSize 100)
  const batch1Consumption: Array<[string, number]> = [
    [zazvor.id, -2.4], [jablkovaStava.id, -7.0], [citronovaStava.id, -3.0],
    [flaska60.id, -200], [etiketa.id, -200], [vrchnak.id, -200],
  ];
  for (const [materialId, quantity] of batch1Consumption) {
    await prisma.stockMovement.create({
      data: { type: "SPOTREBA", materialId, quantity, batchId: batch1.id },
    });
  }
  await prisma.stockMovement.create({
    data: { type: "VYROBA", productId: zazvor60.id, quantity: 200, batchId: batch1.id },
  });

  const batch2 = await prisma.productionBatch.create({
    data: {
      batchNumber: "S2026-0002", productId: kurkuma60.id, producedQty: 100,
      productionDate: daysAgo(5), expiryDate: daysAhead(16), status: "DONE",
    },
  });
  const batch2Consumption: Array<[string, number]> = [
    [kurkuma.id, -0.8], [zazvor.id, -0.4], [jablkovaStava.id, -3.8], [citronovaStava.id, -1.2],
    [korenie.id, -0.02], [flaska60.id, -100], [etiketa.id, -100], [vrchnak.id, -100],
  ];
  for (const [materialId, quantity] of batch2Consumption) {
    await prisma.stockMovement.create({
      data: { type: "SPOTREBA", materialId, quantity, batchId: batch2.id },
    });
  }
  await prisma.stockMovement.create({
    data: { type: "VYROBA", productId: kurkuma60.id, quantity: 100, batchId: batch2.id },
  });
  await prisma.docCounter.create({ data: { id: "SARZA-2026", lastNumber: 2 } });

  // ---------- Objednávky ----------
  const order1 = await prisma.order.create({
    data: {
      orderNumber: "OBJ2026-0001", clientId: fitko.id, channel: "MANUAL", status: "EXPEDOVANA",
      orderDate: daysAgo(7), deliveryDate: daysAgo(4),
      items: {
        create: [
          { productId: zazvor60.id, quantity: 50, unitPriceCents: 180 },
          { productId: kurkuma60.id, quantity: 30, unitPriceCents: 195 },
        ],
      },
    },
  });
  await prisma.stockMovement.create({
    data: { type: "PREDAJ", productId: zazvor60.id, quantity: -50, orderId: order1.id },
  });
  await prisma.stockMovement.create({
    data: { type: "PREDAJ", productId: kurkuma60.id, quantity: -30, orderId: order1.id },
  });

  await prisma.order.create({
    data: {
      orderNumber: "OBJ2026-0002", clientId: klasok.id, channel: "EMAIL", status: "POTVRDENA",
      orderDate: daysAgo(2), deliveryDate: daysAhead(3),
      items: { create: [{ productId: zazvor60.id, quantity: 100, unitPriceCents: 180 }] },
    },
  });
  await prisma.order.create({
    data: {
      orderNumber: "OBJ2026-0003", clientId: jana.id, channel: "WEB", status: "NOVA",
      externalId: "WEB-10023", orderDate: daysAgo(1),
      items: { create: [{ productId: jablko100.id, quantity: 7, unitPriceCents: 320 }] },
    },
  });
  await prisma.order.create({
    data: {
      orderNumber: "OBJ2026-0004", clientId: kaviaren.id, channel: "MANUAL", status: "NOVA",
      orderDate: today,
      items: { create: [{ productId: imunity60.id, quantity: 40, unitPriceCents: 210 }] },
    },
  });
  await prisma.docCounter.create({ data: { id: "OBJ-2026", lastNumber: 4 } });

  // ---------- Predplatné ----------
  await prisma.subscription.create({
    data: {
      clientId: fitko.id, frequency: "WEEKLY", nextRunDate: daysAhead(4),
      note: "Každý pondelok, dodať do 10:00",
      items: {
        create: [
          { productId: zazvor60.id, quantity: 50 },
          { productId: kurkuma60.id, quantity: 30 },
        ],
      },
    },
  });

  // ---------- Faktúry (jednotná evidencia: INTERNA + WEB + SUPERFAKTURA) ----------
  await prisma.invoice.create({
    data: {
      direction: "VYDANA", source: "INTERNA", invoiceNumber: "FA2026001",
      clientId: fitko.id, orderId: order1.id,
      issueDate: daysAgo(4), dueDate: daysAhead(10), status: "UHRADENA",
      totalNetCents: 14850, totalVatCents: 2970, totalGrossCents: 17820,
      variableSymbol: "2026001",
      items: {
        create: [
          { description: "Zázvorový shot 60ml", quantity: 50, unitPriceCents: 180 },
          { description: "Kurkumový shot 60ml", quantity: 30, unitPriceCents: 195 },
        ],
      },
    },
  });
  await prisma.invoice.create({
    data: {
      direction: "VYDANA", source: "SUPERFAKTURA", externalId: "SF-887421", externalNumber: "2026042",
      invoiceNumber: "FA2026002", clientId: klasok.id,
      issueDate: daysAgo(3), dueDate: daysAhead(11), status: "VYSTAVENA",
      totalNetCents: 18000, totalVatCents: 3600, totalGrossCents: 21600,
      variableSymbol: "2026042",
      items: { create: [{ description: "Zázvorový shot 60ml", quantity: 100, unitPriceCents: 180 }] },
    },
  });
  await prisma.invoice.create({
    data: {
      direction: "VYDANA", source: "WEB", externalId: "WEB-10023", externalNumber: "W-2026-10023",
      invoiceNumber: "FA2026003", clientId: jana.id,
      issueDate: daysAgo(1), dueDate: daysAhead(13), status: "VYSTAVENA",
      totalNetCents: 2240, totalVatCents: 448, totalGrossCents: 2688,
      items: { create: [{ description: "Zázvor-jablko shot 100ml", quantity: 7, unitPriceCents: 320 }] },
    },
  });
  await prisma.invoice.create({
    data: {
      direction: "PRIJATA", source: "INTERNA", invoiceNumber: "PF2026001",
      supplierName: "Bio Farma Šariš s.r.o.",
      issueDate: daysAgo(12), dueDate: daysAgo(2), status: "UHRADENA",
      totalNetCents: 6750, totalVatCents: 1350, totalGrossCents: 8100,
      note: "Zázvor 15 kg",
    },
  });
  await prisma.docCounter.createMany({
    data: [
      { id: "VYDANA-2026", lastNumber: 3 },
      { id: "PRIJATA-2026", lastNumber: 1 },
    ],
  });

  // ---------- eKasa ----------
  await prisma.ekasaSale.createMany({
    data: [
      { saleDate: daysAgo(3), receiptNumber: "0001-2026-0451", description: "Zázvorový shot 60ml", productId: zazvor60.id, quantity: 2, totalGrossCents: 500, importBatch: "seed" },
      { saleDate: daysAgo(3), receiptNumber: "0001-2026-0452", description: "Imunity mix 60ml", productId: imunity60.id, quantity: 1, totalGrossCents: 290, importBatch: "seed" },
      { saleDate: daysAgo(2), receiptNumber: "0001-2026-0460", description: "Kurkumový shot 60ml", productId: kurkuma60.id, quantity: 3, totalGrossCents: 810, importBatch: "seed" },
    ],
  });

  // ---------- Plány ----------
  await prisma.monthlyPlan.createMany({
    data: [
      { year: 2026, month: 6, targetRevenueCents: 450000, targetProductionUnits: 1800 },
      { year: 2026, month: 7, targetRevenueCents: 500000, targetProductionUnits: 2000 },
    ],
  });

  // ---------- Inbox ----------
  await prisma.inboxMessage.create({
    data: {
      source: "EMAIL", fromEmail: "nakup@zdravebistro.sk", subject: "Dopyt — pravidelný odber shotov",
      body: "Dobrý deň, mali by sme záujem o pravidelný týždenný odber 60 ks zázvorových shotov pre naše bistro v Nitre. Viete poslať cenovú ponuku? Ďakujem, Marek",
      status: "NOVA", receivedAt: daysAgo(1),
    },
  });
  await prisma.inboxMessage.create({
    data: {
      source: "WEB_FORM", fromEmail: "jana.novakova@gmail.com", subject: "Objednávka z webu #10023",
      body: "Objednávka: 7× Zázvor-jablko shot 100ml. Doručenie: Pezinok.",
      rawJson: JSON.stringify({ orderId: "WEB-10023", items: [{ sku: "ZJ-100", qty: 7 }] }),
      status: "SPRACOVANA", receivedAt: daysAgo(1),
    },
  });

  console.log("✅ Seed hotový: 3 používatelia, 5 produktov, 10 surovín, 4 receptúry, 2 šarže, 5 klientov, 4 objednávky, 1 predplatné, 5 faktúr, eKasa, plány, inbox.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
