import { expect, test } from "vitest";
import { clientAddressFromHeaders } from "./client-address";

test("vyberie sprava poslednú verejnú IP a preskočí interný proxy hop", () => {
  const headers = new Headers({
    "x-forwarded-for": "8.8.8.8, 1.1.1.1, 10.20.30.40",
  });
  expect(clientAddressFromHeaders(headers)).toBe("1.1.1.1");
});

test("ignoruje klientom podstrčenú ľavú IP, keď proxy pridá reálnu adresu", () => {
  const headers = new Headers({
    "x-forwarded-for": "8.8.8.8, 9.9.9.9",
  });
  expect(clientAddressFromHeaders(headers)).toBe("9.9.9.9");
});

test("podporuje IPv4 port, IPv6 hranaté zátvorky a X-Real-IP fallback", () => {
  expect(
    clientAddressFromHeaders(
      new Headers({ "x-forwarded-for": "10.0.0.5:1234" }),
    ),
  ).toBe("10.0.0.5");
  expect(
    clientAddressFromHeaders(
      new Headers({ "x-forwarded-for": "[2001:4860:4860::8888]:443" }),
    ),
  ).toBe("2001:4860:4860::8888");
  expect(
    clientAddressFromHeaders(new Headers({ "x-real-ip": "1.0.0.1" })),
  ).toBe("1.0.0.1");
});

test("bez dôveryhodnej hlavičky vráti stabilný anonymný fallback", () => {
  expect(clientAddressFromHeaders(new Headers())).toBe("unknown");
});
