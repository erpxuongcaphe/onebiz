export function isSupplierGroupCode(code: string): boolean {
  return code !== "NB" && /^[A-Z][A-Z0-9]{1,7}$/.test(code);
}
