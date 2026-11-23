import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { parseTaxRegisterZip } from "./export";
import { lookupCustomerTax } from "./lookup";

async function* zip(filename: string, contents: string): AsyncGenerator<Uint8Array> {
  const bytes = zipSync({ [filename]: strToU8(contents) });
  for (let offset = 0; offset < bytes.length; offset += 13) {
    yield bytes.subarray(offset, offset + 13);
  }
}

const date = "<DatumAktualizacieZoznamu>23112026</DatumAktualizacieZoznamu>";
function vatItem(ico: string, vat: string, code: string, payerFrom = "") {
  return `<ITEM><ICO>${ico}</ICO><IC_DPH>${vat}</IC_DPH><DRUH_REG_DPH>${code}</DRUH_REG_DPH><PLAT_DPH_OD>${payerFrom}</PLAT_DPH_OD></ITEM>`;
}

describe("exporty Finančnej správy", () => {
  it("používa samostatné DIČ a IČ DPH, rozlišuje platiteľa, §7a a nejednoznačný záznam", async () => {
    const income = await parseTaxRegisterZip("income", zip("ds_dsrdp.xml",
      `<ZoznamSubjektovRegistrovanychNaDP>${date}<DS_DSRDP><ITEM><ICO>00686930</ICO><DIC>2020408522</DIC></ITEM></DS_DSRDP></ZoznamSubjektovRegistrovanychNaDP>`,
    ));
    const vatRows = [
      vatItem("52009183", "SK2020000004", "§7a"),
      vatItem("00686930", "SK7020000944", "§4", "01.01.2004"),
      vatItem("00686930", "SK7020000944", "§4", "01.01.2004"),
      vatItem("00000101", "SK2020000003", "§4b", "01.01.2004"),
      vatItem("00000101", "SK2020000005", "§4b", "01.01.2004"),
    ].join("");
    const vat = await parseTaxRegisterZip("vat", zip("ds_dphs.xml",
      `<ZoznamSubjektovRegistrovanychkDPH>${date}<DS_DPHS>${vatRows}</DS_DPHS></ZoznamSubjektovRegistrovanychkDPH>`,
    ));
    const data = { income, vat };
    expect(lookupCustomerTax("00686930", data)).toEqual({ dic: "2020408522", icDph: "SK7020000944", vatStatus: "PAYER", vatCheckedOn: "2026-11-23" });
    expect(lookupCustomerTax("52009183", data)).toMatchObject({ icDph: "SK2020000004", vatStatus: "REGISTERED_NON_PAYER" });
    expect(lookupCustomerTax("00000101", data)).toMatchObject({ icDph: "", vatStatus: "UNKNOWN" });
    expect(lookupCustomerTax("52009182", data)).toMatchObject({ icDph: "", vatStatus: "NON_PAYER" });
    expect(lookupCustomerTax("52009182", { income })).toMatchObject({ icDph: "", vatStatus: "UNKNOWN" });
  });
  it("odmietne neúplný export", async () => {
    await expect(parseTaxRegisterZip("vat", zip("ds_dphs.xml", `<ZoznamSubjektovRegistrovanychkDPH>${date}`))).rejects.toThrow();
  });
});
