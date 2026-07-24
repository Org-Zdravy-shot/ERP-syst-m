import { describe, expect, it } from "vitest";
import { LocalFsDocumentStorage } from "./local-storage";

describe("LocalFsDocumentStorage", () => {
  it("odmietne objectKey mimo koreňového adresára", async () => {
    const storage = new LocalFsDocumentStorage("/tmp/zdravy-shot-storage-test");
    await expect(storage.getObject("../mimo.pdf")).rejects.toThrow(/Neplatný objectKey/);
  });
});
