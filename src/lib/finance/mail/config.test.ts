import { afterEach, describe, expect, test } from "vitest";
import { readSmtpConfig, smtpConfigured } from "./config";

const original = {
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_SECURE: process.env.SMTP_SECURE,
};

afterEach(() => {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe.sequential("SMTP konfigurácia", () => {
  test("odmietne neplatný port", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587abc";

    expect(smtpConfigured()).toBe(false);
    expect(() => readSmtpConfig()).toThrow(/SMTP_PORT/);
  });

  test("vyžaduje používateľa a heslo spoločne", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "mailer";
    delete process.env.SMTP_PASS;

    expect(() => readSmtpConfig()).toThrow(/spoločne/);
  });

  test("vráti úplnú TLS konfiguráciu", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "mailer";
    process.env.SMTP_PASS = "secret";

    expect(readSmtpConfig()).toEqual({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "mailer",
      pass: "secret",
    });
  });
});
