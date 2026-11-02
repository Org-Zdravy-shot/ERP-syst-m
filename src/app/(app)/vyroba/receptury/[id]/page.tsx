import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/prisma";
import { formatQty } from "@/lib/format";
import { deleteRecipeItem, updateRecipe, upsertRecipeItem } from "../../_actions";
import {
  btnPrimary,
  btnSecondary,
  btnSmall,
  btnSmallDanger,
  card,
  cardHeader,
  errorBox,
  labelSmall,
  table,
  thead,
  tr,
  td,
  tdRight,
} from "@/components/ui";

const inlineInput =
  "rounded-[10px] border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-stone-950 focus:ring-[3px] focus:ring-brand/35";

export default async function RecipeEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chyba?: string }>;
}) {
  const { id } = await params;
  const { chyba } = await searchParams;

  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: {
      product: { select: { name: true } },
      items: { include: { material: true }, orderBy: { material: { name: "asc" } } },
    },
  });
  if (!recipe) notFound();

  const usedMaterialIds = new Set(recipe.items.map((i) => i.materialId));
  const availableMaterials = await prisma.material.findMany({
    where: { isActive: true, id: { notIn: [...usedMaterialIds] } },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title={`Receptúra: ${recipe.product.name}`}
        subtitle={`Spotreba surovín a obalov na dávku ${recipe.batchSize} ks`}
      >
        <Link href="/vyroba/receptury" className={btnSecondary}>
          ← Všetky receptúry
        </Link>
      </PageHeader>

      {chyba && <p className={`${errorBox} mb-4 max-w-3xl`}>{chyba}</p>}

      <div className="max-w-3xl space-y-5">
        <form action={updateRecipe} className={`${card} flex flex-wrap items-end gap-3 p-4`}>
          <input type="hidden" name="recipeId" value={recipe.id} />
          <div>
            <label className={labelSmall}>Veľkosť dávky (ks)</label>
            <input
              name="batchSize"
              type="number"
              min="1"
              defaultValue={recipe.batchSize}
              className={`${inlineInput} w-32`}
            />
          </div>
          <div className="min-w-48 flex-1">
            <label className={labelSmall}>Poznámka</label>
            <input name="note" defaultValue={recipe.note ?? ""} className={`${inlineInput} w-full`} />
          </div>
          <button type="submit" className={btnPrimary}>
            Uložiť
          </button>
        </form>

        <div className={card}>
          <div className={cardHeader}>Suroviny a obaly na {recipe.batchSize} ks</div>
          <table className={table}>
            <thead>
              <tr className={thead}>
                <th className="px-[18px] py-2 font-medium">Surovina / obal</th>
                <th className="px-[18px] py-2 text-right font-medium">Množstvo</th>
                <th className="px-[18px] py-2 font-medium">Upraviť</th>
              </tr>
            </thead>
            <tbody>
              {recipe.items.map((item) => (
                <tr key={item.id} className={tr}>
                  <td className={td}>
                    {item.material.name}{" "}
                    <span className="text-xs text-stone-400">({item.material.unit})</span>
                  </td>
                  <td className={tdRight}>{formatQty(item.quantity, item.material.unit)}</td>
                  <td className="px-[18px] py-[9px]">
                    <div className="flex items-center gap-2">
                      <form action={upsertRecipeItem} className="flex items-center gap-2">
                        <input type="hidden" name="recipeId" value={recipe.id} />
                        <input type="hidden" name="materialId" value={item.materialId} />
                        <input
                          name="quantity"
                          defaultValue={String(item.quantity).replace(".", ",")}
                          className={`${inlineInput} w-24`}
                        />
                        <button type="submit" className={btnSmall}>
                          Uložiť
                        </button>
                      </form>
                      <form action={deleteRecipeItem}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="recipeId" value={recipe.id} />
                        <button type="submit" className={btnSmallDanger}>
                          Odstrániť
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {recipe.items.length === 0 && (
                <tr className={tr}>
                  <td colSpan={3} className="px-[18px] py-6 text-center text-stone-400">
                    Receptúra zatiaľ nemá žiadne suroviny ani obaly — pridajte ich nižšie
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {availableMaterials.length > 0 && (
          <form action={upsertRecipeItem} className={`${card} flex flex-wrap items-end gap-3 p-4`}>
            <input type="hidden" name="recipeId" value={recipe.id} />
            <div className="min-w-56 flex-1">
              <label className={labelSmall}>Pridať surovinu alebo obal</label>
              <select name="materialId" required className={`${inlineInput} w-full`} defaultValue="">
                <option value="" disabled>
                  — vyberte —
                </option>
                <optgroup label="Suroviny">{availableMaterials.filter((m) => m.kind !== "PACKAGING").map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</optgroup>
                <optgroup label="Obaly a fľaše">{availableMaterials.filter((m) => m.kind === "PACKAGING").map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</optgroup>
              </select>
            </div>
            <div>
              <label className={labelSmall}>Množstvo na dávku</label>
              <input name="quantity" required placeholder="napr. 1,2" className={`${inlineInput} w-32`} />
            </div>
            <button type="submit" className={btnPrimary}>
              Pridať
            </button>
          </form>
        )}
      </div>
    </>
  );
}
