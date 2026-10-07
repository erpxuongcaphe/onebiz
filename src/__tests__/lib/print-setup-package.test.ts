import { describe, expect, it } from "vitest";
import { buildSetupZip } from "@/lib/printer/setup-package";
describe("private branch print setup archive", () => {
  it("stores every file with matching local and central directory lengths", () => {
    const data = new TextEncoder().encode('{"pointId":"test"}');
    const zip = buildSetupZip([{ name: "onebiz-print-point.json", data }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0,true)).toBe(0x04034b50);
    const bodyOffset = 30 + view.getUint16(26,true);
    expect(Array.from(zip.slice(bodyOffset, bodyOffset+data.length))).toEqual(Array.from(data));
    const centralOffset = view.getUint32(zip.length-6,true);
    expect(view.getUint32(centralOffset,true)).toBe(0x02014b50);
    expect(view.getUint32(centralOffset+16,true)).toBe(view.getUint32(14,true));
    expect(view.getUint32(centralOffset+20,true)).toBe(data.length);
    expect(view.getUint16(zip.length-14,true)).toBe(1);
  });
  it("rejects paths outside the setup folder", () => {
    expect(() => buildSetupZip([{ name: "../config.json", data: new Uint8Array() }])).toThrow();
  });
});
