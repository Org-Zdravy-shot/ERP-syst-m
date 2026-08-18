import { describe, expect, it } from "vitest";
import { slovakPeppolEndpoint } from "./peppol-id";

describe("slovakPeppolEndpoint", () => {
  it("použije testovaciu schému providera v sandboxe", () => {
    expect(slovakPeppolEndpoint(" 2123456789 ", "sandbox")).toEqual({
      schemeId: "9915",
      value: "2123456789",
      peppolId: "9915:2123456789",
    });
  });

  it("použije oficiálnu schému DIČ v produkcii", () => {
    expect(slovakPeppolEndpoint("2123456789", "production")).toEqual({
      schemeId: "0245",
      value: "2123456789",
      peppolId: "0245:2123456789",
    });
  });

  it("odmietne IČO alebo neúplné DIČ", () => {
    expect(() => slovakPeppolEndpoint("12345678", "sandbox")).toThrow(
      "DIČ s 10 číslicami",
    );
  });
});
