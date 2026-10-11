export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export function evidenceMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  const text = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  if (text(0, 5) === "%PDF-") return "application/pdf";
  return null;
}
