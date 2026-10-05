import { loadBridgePrinter } from "@/lib/printer/qz-bridge";
/**
 * print-stations.ts — Helper split items theo trạm chế biến rồi in N phiếu.
 * Sprint KITCHEN-1 (CEO 07/05).
 *
 * Workflow:
 *   1. Lookup product → station map (qua category.kitchen_station_id)
 *   2. Get all stations metadata (name, color, header_text, auto_print)
 *   3. Group items by station_id (null = legacy mặc định)
 *   4. Print 1 ticket per station — header LỚN tên trạm + màu badge
 *
 * Backward compat: tenant chưa setup multi-station → tất cả items thuộc
 * station đầu tiên (đã backfill ở migration 00054) → in 1 phiếu y hệt cũ.
 */

import { printKitchenTicketV2, type KitchenTicketDataV2 } from "@/lib/print-fnb";
import { applyKitchenTemplate, resolveKitchenPrintTemplate } from "@/lib/kitchen-print-template";
import { loadStationPrinter } from "@/lib/printer/station-printers";
import {
  getStationsByProductIds,
  getKitchenStationsByBranch,
  type KitchenStation,
} from "@/lib/services/supabase/kitchen-stations";

interface RawTicketItem {
  /** Reprints retain the station assigned when the order was sent. */
  stationId?: string | null;
  productId: string;
  productName: string;
  variantLabel?: string | null;
  quantity: number;
  unitPrice: number;
  toppings: { name: string; quantity: number; price: number }[];
  /**
   * Nhãn tuỳ chọn ("Mức đường: 50%", "Mức đá: Ít đá"). Trước đây kiểu này
   * KHÔNG khai trường trên, nên POS truyền vào bao nhiêu cũng bị bước tách
   * trạm bỏ đi — bếp nhận phiếu giấy không có Đường/Đá. TypeScript không
   * bắt được vì đối tượng đi qua `.map()` nên mất kiểm tra thuộc tính thừa.
   */
  modifierLabels?: string[];
  note?: string | null;
}

// Sprint POS-FNB-EXT-1: orderNote vẫn passable qua baseData
type BaseTicketData = Omit<KitchenTicketDataV2, "items" | "stationName" | "stationColor">;

/**
 * Split items theo trạm + in 1 phiếu mỗi trạm. Skip station có
 * settings.auto_print === false (cho trạm chỉ KDS không in).
 *
 * @returns Số phiếu đã in (informational, không throw nếu 0).
 */
export async function printKitchenTicketsByStation(
  items: RawTicketItem[],
  baseData: BaseTicketData,
  branchId: string,
  options: { manual?: boolean } = {},
): Promise<number> {
  if (items.length === 0) return 0;

  // Bulk lookup product → station + stations metadata
  const productIds = Array.from(new Set(items.map((i) => i.productId)));
  const [stationMap, stations, template] = await Promise.all([
    getStationsByProductIds(productIds).catch(() => new Map<string, string | null>()),
    getKitchenStationsByBranch(branchId).catch(() => [] as KitchenStation[]),
    resolveKitchenPrintTemplate(branchId),
  ]);

  const stationsById = new Map(stations.map((s) => [s.id, s] as const));

  // Group items by station_id
  const grouped = new Map<string | "no_station", RawTicketItem[]>();
  for (const item of items) {
    const sid = item.stationId !== undefined ? item.stationId : stationMap.get(item.productId) ?? null;
    const key = sid ?? "no_station";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  // Sort groups theo sort_order của station (nếu có) để in theo thứ tự ưu tiên
  const sortedEntries = Array.from(grouped.entries()).sort((a, b) => {
    const sa = stationsById.get(a[0]);
    const sb = stationsById.get(b[0]);
    return (sa?.sortOrder ?? 999) - (sb?.sortOrder ?? 999);
  });

  let printedCount = 0;
  for (const [stationKey, groupItems] of sortedEntries) {
    const station =
      stationKey !== "no_station" ? stationsById.get(stationKey) : null;

    // An explicitly assigned inactive/foreign station must not be redirected
    // to the shared kitchen device. Manual historical reprints retain its slot.
    if (!options.manual && stationKey !== "no_station" && !station) continue;

    // Skip nếu station tắt auto_print
    if (!options.manual && station && station.settings.auto_print === false) continue;

    const stationName =
      station?.settings.header_text?.trim() ||
      station?.name?.toUpperCase() ||
      undefined; // undefined → printKitchenTicketV2 dùng "PHIẾU BAR/BẾP" mặc định

    const ticket: KitchenTicketDataV2 = {
      ...baseData,
      stationName,
      stationColor: station?.color,
      bridgePrinter: stationKey !== "no_station" ? loadBridgePrinter("kitchen", branchId, stationKey) ?? undefined : undefined,
      printer: stationKey !== "no_station" ? loadStationPrinter(branchId, stationKey) ?? undefined : undefined,
      items: groupItems.map((it) => ({
        name: it.productName,
        variant: it.variantLabel ?? undefined,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        toppings: it.toppings,
        modifierLabels: it.modifierLabels,
        note: it.note ?? undefined,
      })),
    };
    await printKitchenTicketV2(template ? applyKitchenTemplate(ticket, template.config, template.paperSize) : ticket);
    printedCount++;
  }

  return printedCount;
}
