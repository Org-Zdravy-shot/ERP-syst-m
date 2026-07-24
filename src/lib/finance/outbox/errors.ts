/**
 * Chyba, ktorú netreba opakovať (napr. klient nemá e-mail, doklad nie je
 * finalizovaný). Worker takúto udalosť označí FAILED bez ďalších pokusov.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
