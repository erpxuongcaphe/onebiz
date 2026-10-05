import { describe, expect, it } from "vitest";
import { encodeRaster } from "@/lib/printer/raster-print";

describe("ESC/POS raster encoder", () => {
  it("packs black dots MSB first and leaves transparent dots white", () => {
    const pixels = new Uint8ClampedArray([0,0,0,255,255,255,255,255,0,0,0,0]);
    const bytes = encodeRaster(3,1,pixels);
    expect([...bytes.slice(5,14)]).toEqual([0x1d,0x76,0x30,0,1,0,1,0,0x80]);
    expect([...bytes.slice(-6)]).toEqual([0x1b,0x64,3,0x1d,0x56,1]);
  });
  it.each([384,576])("uses the exact printable dot width %s", width => {
    const bytes = encodeRaster(width,1,new Uint8ClampedArray(width*4).fill(255));
    expect(bytes[9]).toBe(width/8);
    expect(bytes.length).toBe(5+8+width/8+6);
  });
  it("splits long receipts at 256 rows without dropping a row", () => {
    const bytes=encodeRaster(8,257,new Uint8ClampedArray(8*257*4).fill(255));
    expect([...bytes.slice(5,13)]).toEqual([29,118,48,0,1,0,0,1]);
    expect([...bytes.slice(269,277)]).toEqual([29,118,48,0,1,0,1,0]);
    expect(bytes.length).toBe(5+16+257+6);
  });
  it.each([[577,1],[0,1],[1,24001],[1,0]])("rejects unsafe dimensions %s x %s", (w,h) => {
    expect(()=>encodeRaster(w,h,new Uint8ClampedArray(0))).toThrow();
  });
});
