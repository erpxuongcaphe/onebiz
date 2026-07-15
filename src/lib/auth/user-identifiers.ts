export const INTERNAL_AUTH_EMAIL_DOMAIN = "auth.onebiz.invalid";

export function normalizeVnPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 11 && digits.startsWith("84")) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

export function isValidVnPhone(value: string): boolean {
  return /^0\d{9,10}$/.test(normalizeVnPhone(value));
}

export function isInternalAuthEmail(value: string | null | undefined): boolean {
  return Boolean(value?.toLowerCase().endsWith(`@${INTERNAL_AUTH_EMAIL_DOMAIN}`));
}
