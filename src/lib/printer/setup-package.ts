/** Small, uncompressed ZIP for the print-point scripts and private config.
 * Credentials stay in browser memory and in the downloaded local package. */
export function buildSetupZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  if (entries.length > 32) throw new Error("Too many setup files");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(entry.name) || entry.name.includes("..")) throw new Error("Invalid setup filename");
    const name = encoder.encode(entry.name);
    let crc = 0xffffffff;
    for (const byte of entry.data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, entry.data.length, true); lv.setUint32(22, entry.data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length);
    const cv = new DataView(record.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, entry.data.length, true); cv.setUint32(24, entry.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    record.set(name, 46);
    chunks.push(local, entry.data); central.push(record); offset += local.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...chunks, ...central, end]) { result.set(part, cursor); cursor += part.length; }
  return result;
}

export async function getPrintSetupFiles() {
  const files = ["agent.mjs", "destination.mjs", "network.mjs", "spool.ps1", "run.ps1", "setup.ps1", "runtime.ps1", "Cai-diem-in.cmd", "README.txt"];
  const entries = await Promise.all(files.map(async name => {
    const response = await fetch(`/print-point/${name}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Không tải đủ bộ kết nối. Thử lại trước khi cấp mã kết nối mới.");
    return { name, data: new Uint8Array(await response.arrayBuffer()) };
  }));
  return entries;
}

export function downloadPrintSetup(config: Record<string, unknown>, files: { name: string; data: Uint8Array }[]) {
  const entries = [...files, { name: "onebiz-print-point.json", data: new TextEncoder().encode(JSON.stringify(config, null, 2)) }];
  const bytes = buildSetupZip(entries);
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "onebiz-diem-in-chi-nhanh.zip"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
