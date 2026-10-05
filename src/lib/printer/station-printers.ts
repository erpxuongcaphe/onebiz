import type { ConnectedPrinter, StoredPrinter } from "./webusb-printer";

// A device belongs to this browser. Branch + station prevent cross-branch routing.
function key(branchId: string, stationId: string): string {
  return `onebiz_station_printer:${encodeURIComponent(branchId)}:${encodeURIComponent(stationId)}`;
}

export function loadStationPrinter(branchId: string, stationId: string): StoredPrinter | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(branchId, stationId));
    if (!raw) return null;
    const printer = JSON.parse(raw) as StoredPrinter;
    return Number.isInteger(printer.vendorId) && Number.isInteger(printer.productId) ? printer : null;
  } catch { return null; }
}

export function saveStationPrinter(branchId: string, stationId: string, printer: ConnectedPrinter): void {
  localStorage.setItem(key(branchId, stationId), JSON.stringify({ ...printer, role: "kitchen", connectedAt: new Date().toISOString() }));
}

export function clearStationPrinter(branchId: string, stationId: string): void {
  localStorage.removeItem(key(branchId, stationId));
}
