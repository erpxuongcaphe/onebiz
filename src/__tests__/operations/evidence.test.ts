import { describe, expect, it } from "vitest";
import { evidenceMime } from "@/lib/operations/evidence";
describe("Evidence file validation", () => {
  it("recognizes PNG signatures", () =>
    expect(
      evidenceMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    ).toBe("image/png"));
  it("recognizes JPEG signatures", () =>
    expect(evidenceMime(new Uint8Array([255, 216, 255, 1]))).toBe(
      "image/jpeg",
    ));
  it("recognizes PDF signatures", () =>
    expect(evidenceMime(new TextEncoder().encode("%PDF-1.7"))).toBe(
      "application/pdf",
    ));
  it("rejects renamed HTML and SVG", () => {
    expect(evidenceMime(new TextEncoder().encode("<html>"))).toBeNull();
    expect(evidenceMime(new TextEncoder().encode("<svg/>"))).toBeNull();
  });
  it("does not accept RIFF alone as WebP", () =>
    expect(evidenceMime(new TextEncoder().encode("RIFF1234WAVE"))).toBeNull());
});
