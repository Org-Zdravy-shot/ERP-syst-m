-- Jeden EUR účet môže byť primárny v každej časovej verzii profilu toho istého subjektu.
-- Existujúce účty a bankové transakcie sa nemenia.
DROP INDEX "BankAccount_iban_currency_key";
CREATE UNIQUE INDEX "BankAccount_companyProfileId_iban_currency_key" ON "BankAccount"("companyProfileId", "iban", "currency");
CREATE INDEX "BankAccount_iban_currency_idx" ON "BankAccount"("iban", "currency");
