import { bridgeHtml } from "./qz-bridge";
import type { PaperWidth } from "./escpos";

/** GS v 0 raster, 203dpi: 384/576 dots = the common 48/72mm printable area. */
export function encodeRaster(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  if (width < 1 || width > 576 || height < 1 || height > 24000 || rgba.length !== width * height * 4) throw new Error("Kích thước bản in không hợp lệ hoặc đơn quá dài.");
  const stride = Math.ceil(width / 8);
  const chunks: Uint8Array[] = [new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 1])];
  for (let top = 0; top < height; top += 256) {
    const rows = Math.min(256, height - top);
    const data = new Uint8Array(8 + stride * rows);
    data.set([0x1d, 0x76, 0x30, 0, stride & 255, stride >> 8, rows & 255, rows >> 8]);
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const offset = ((top + y) * width + x) * 4;
      const alpha = rgba[offset + 3] / 255;
      const lightness = (0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]) * alpha + 255 * (1 - alpha);
      if (lightness < 160) data[8 + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
    chunks.push(data);
  }
  chunks.push(new Uint8Array([0x1b, 0x64, 3, 0x1d, 0x56, 1]));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of chunks) { out.set(chunk, position); position += chunk.length; }
  return out;
}

export async function renderPrintRaster(html: string, paper: PaperWidth): Promise<HTMLCanvasElement> {
  const frame = document.createElement("iframe");
  const dots = paper === "58mm" ? 384 : 576;
  const cssWidth = paper === "58mm" ? 58 / 25.4 * 96 : 80 / 25.4 * 96;
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${cssWidth}px;height:1px;border:0`;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Dựng bản in quá thời gian. Hãy dùng in qua trình duyệt.")), 5000);
      frame.onload = () => {clearTimeout(timer); resolve();};
      frame.srcdoc = bridgeHtml(html);
      document.body.appendChild(frame);
    });
    const doc = frame.contentDocument;
    if (!doc?.body) throw new Error("Không dựng được bản in USB.");
    await Promise.all(Array.from(doc.images).map(async img => {
      if (!img.src.startsWith("data:")) {
        const response = await fetch(img.src, {signal:AbortSignal.timeout(5000)});
        if (!response.ok) throw new Error("Không tải được logo/QR cho bản in.");
        const blob = await response.blob();
        img.src = await new Promise<string>((resolve,reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
        });
      }
      await img.decode();
    }));
    await doc.fonts?.ready;
    const { default: html2canvas } = await import("html2canvas");
    const height = Math.ceil(Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight));
    if (height * dots / cssWidth > 24000) throw new Error("Đơn quá dài cho một bản in USB. Hãy dùng in qua trình duyệt.");
    const canvas = await html2canvas(doc.body, { width:cssWidth, height, scale:dots / cssWidth, backgroundColor:"#ffffff", logging:false, scrollX:0, scrollY:0, windowWidth:Math.ceil(cssWidth), useCORS:true });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Không dựng được ảnh in.");
    return canvas;
  } finally { frame.remove(); }
}

export async function rasterPrintBytes(html: string, paper: PaperWidth): Promise<Uint8Array> {
  const canvas = await renderPrintRaster(html, paper);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không dựng được ảnh in.");
  return encodeRaster(canvas.width, canvas.height, ctx.getImageData(0,0,canvas.width,canvas.height).data);
}
