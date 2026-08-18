import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("proxy", () => {
  test("pustí presný eFaktúra webhook bez používateľskej session", () => {
    const response = proxy(
      new NextRequest("https://erp.example/api/financie/einvoice/webhook"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("nepustí inú finančnú API cestu bez session", () => {
    const response = proxy(
      new NextRequest("https://erp.example/api/financie/einvoice/webhook/status"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://erp.example/login");
  });

  test("pustí health check bez používateľskej session", () => {
    const response = proxy(new NextRequest("https://erp.example/api/health"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
