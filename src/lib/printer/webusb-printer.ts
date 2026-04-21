/**
 * WebUSB Printer Wrapper
 * ------------------------------------------------------------
 * Kết nối máy in nhiệt qua WebUSB API. Hỗ trợ nhiều hiệu phổ
 * biến bằng cách request với `filters: []` (user chọn từ list)
 * HOẶC filter theo Vendor ID nếu user đã ghép từ trước.
 *
 * Browser support:
 *   ✅ Chrome, Edge, Opera (desktop + Android)
 *   ❌ Firefox, Safari (phải fallback browser print)
 *
 * Lưu ý quan trọng:
 *   - WebUSB yêu cầu HTTPS (trừ localhost)
 *   - User phải chọn device trong popup (security requirement)
 *   - Permission tồn tại chỉ trong session — sau khi reload app,
 *     user phải grant lại (TRỪ KHI dùng `navigator.usb.getDevices()`
 *     trả về list đã paired → gọi được .open() mà không cần popup)
 *   - Device.productId + vendorId persist localStorage để tự
 *     reconnect sau reload nếu browser còn nhớ permission
 */

// ─── Vendor IDs (các hiệu phổ biến ở VN) ───
// Reference: https://devicehunt.com/all-usb-vendors
const PRINTER_VENDORS = [
  { vendorId: 0x04b8, name: "Epson" }, // TM-T20, TM-T82, TM-T88
  { vendorId: 0x0519, name: "Xprinter (Star Micronics)" },
  { vendorId: 0x0fe6, name: "Xprinter/ICS (XP-58/XP-80)" },
  { vendorId: 0x0dd4, name: "Custom Engineering" },
  { vendorId: 0x0416, name: "Winbond (Rongta, Gprinter)" },
  { vendorId: 0x0483, name: "STMicroelectronics" },
  { vendorId: 0x1cbe, name: "Gprinter / Luxvisions" },
  { vendorId: 0x28e9, name: "Gprinter GD" },
  { vendorId: 0x0456, name: "Advanced Micro Devices" }, // Xprinter OEM
  { vendorId: 0x154f, name: "SNBC / Beiyang" },
  { vendorId: 0x1504, name: "Bixolon / SRP-series" },
  { vendorId: 0x0a5f, name: "Zebra (GX/GK/ZD)" },
  { vendorId: 0x6868, name: "Zjiang (ZJ-5802, ZJ-8001)" },
];

// ─── Minimal WebUSB types (TypeScript không có built-in) ───

interface USBDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  opened: boolean;
  configuration: USBConfiguration | null;
  configurations: USBConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<USBOutTransferResult>;
}

interface USBConfiguration {
  configurationValue: number;
  interfaces: USBInterface[];
}

interface USBInterface {
  interfaceNumber: number;
  alternate: USBAlternateInterface;
  alternates: USBAlternateInterface[];
  claimed: boolean;
}

interface USBAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  endpoints: USBEndpoint[];
}

interface USBEndpoint {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
  packetSize: number;
}

interface USBOutTransferResult {
  bytesWritten: number;
  status: "ok" | "stall" | "babble";
}

interface NavigatorUSB {
  requestDevice(options: { filters: Array<{ vendorId?: number; productId?: number }> }): Promise<USBDevice>;
  getDevices(): Promise<USBDevice[]>;
}

// Type assertion helper — navigator.usb không có trong lib.dom
function getUSB(): NavigatorUSB | null {
  if (typeof navigator === "undefined") return null;
  // @ts-expect-error — WebUSB is experimental, not in TS lib yet
  return navigator.usb ?? null;
}

// ─── Public API ───

export interface ConnectedPrinter {
  vendorId: number;
  productId: number;
  name: string;
  manufacturer: string;
}

/** Check if browser supports WebUSB */
export function isWebUsbSupported(): boolean {
  return getUSB() !== null && typeof window !== "undefined" && "isSecureContext" in window
    ? window.isSecureContext
    : false;
}

/** Check if we're in a secure context (required for WebUSB) */
export function isSecureContext(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}

/**
 * Yêu cầu user chọn máy in. Gọi trong event handler (click)
 * vì browser require user gesture cho WebUSB popup.
 */
export async function requestPrinter(): Promise<ConnectedPrinter | null> {
  const usb = getUSB();
  if (!usb) throw new Error("Trình duyệt không hỗ trợ WebUSB. Vui lòng dùng Chrome/Edge.");
  if (!isSecureContext()) throw new Error("WebUSB yêu cầu HTTPS. Kết nối hiện tại không an toàn.");

  try {
    // Filter theo Vendor ID phổ biến — user vẫn có thể chọn "Any device"
    const filters = PRINTER_VENDORS.map((v) => ({ vendorId: v.vendorId }));
    const device = await usb.requestDevice({ filters });

    return {
      vendorId: device.vendorId,
      productId: device.productId,
      name: device.productName ?? "Unknown Printer",
      manufacturer:
        device.manufacturerName ??
        PRINTER_VENDORS.find((v) => v.vendorId === device.vendorId)?.name ??
        "Unknown",
    };
  } catch (err) {
    if (err instanceof Error && err.name === "NotFoundError") {
      // User cancelled — return null thay vì throw
      return null;
    }
    throw err;
  }
}

/**
 * Lấy device đã paired trước đó (không cần user gesture).
 * Dùng để reconnect sau reload trang.
 */
async function getPairedDevice(vendorId: number, productId: number): Promise<USBDevice | null> {
  const usb = getUSB();
  if (!usb) return null;
  try {
    const devices = await usb.getDevices();
    return devices.find((d) => d.vendorId === vendorId && d.productId === productId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Gửi byte array tới máy in qua WebUSB.
 * Tự động mở device + claim interface + tìm OUT endpoint + transfer.
 */
export async function sendToUsbPrinter(
  vendorId: number,
  productId: number,
  data: Uint8Array
): Promise<void> {
  const device = await getPairedDevice(vendorId, productId);
  if (!device) {
    throw new Error(
      "Không tìm thấy máy in đã kết nối. Vui lòng vào Cài đặt → In ấn → Kết nối lại máy in."
    );
  }

  try {
    if (!device.opened) await device.open();

    // Nhiều printer chỉ có 1 config — select nếu chưa
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // Tìm interface + endpoint OUT (bulk)
    const iface = device.configuration?.interfaces.find((i) =>
      i.alternate.endpoints.some((e) => e.direction === "out" && e.type === "bulk")
    );
    if (!iface) {
      throw new Error("Máy in không có endpoint in. Thiết bị có thể không phải printer.");
    }

    if (!iface.claimed) {
      await device.claimInterface(iface.interfaceNumber);
    }

    const endpoint = iface.alternate.endpoints.find(
      (e) => e.direction === "out" && e.type === "bulk"
    );
    if (!endpoint) throw new Error("Không tìm được OUT endpoint");

    // Split data thành chunk theo packetSize (tránh overflow buffer máy in)
    const chunkSize = endpoint.packetSize || 64;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const result = await device.transferOut(endpoint.endpointNumber, chunk);
      if (result.status !== "ok") {
        throw new Error(`Transfer failed: ${result.status}`);
      }
    }
  } catch (err) {
    // Attempt graceful cleanup — ignore close errors
    try {
      if (device.opened) await device.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Storage key cho localStorage */
const PRINTER_STORAGE_KEY = "onebiz_usb_printer";

export interface StoredPrinter {
  vendorId: number;
  productId: number;
  name: string;
  manufacturer: string;
  connectedAt: string;
}

export function savePrinter(printer: ConnectedPrinter): void {
  if (typeof window === "undefined") return;
  const stored: StoredPrinter = {
    ...printer,
    connectedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

export function loadPrinter(): StoredPrinter | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PRINTER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredPrinter;
  } catch {
    return null;
  }
}

export function clearPrinter(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PRINTER_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
