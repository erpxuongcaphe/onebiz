import type { KitchenOrderItem } from "@/lib/types/fnb";

type StationVisibility = { id: string; settings: { show_on_kds?: boolean } };

/** Print-only routing never changes the order, payment or inventory state. */
export function getKdsStationItems<T extends Pick<KitchenOrderItem, "kitchenStationId">>(
  items: T[], stations: StationVisibility[], selectedStation: string | null = null,
): T[] {
  if (stations.length > 0 && stations.every(station => station.settings.show_on_kds === false)) return [];
  const hiddenIds = new Set(stations.filter(station => station.settings.show_on_kds === false).map(station => station.id));
  return items.filter(item =>
    (!item.kitchenStationId || !hiddenIds.has(item.kitchenStationId)) &&
    (!selectedStation || item.kitchenStationId === selectedStation),
  );
}
