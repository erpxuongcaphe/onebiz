export interface ThermalLayoutConfig {
  compact?: boolean;
  font?: "sans" | "mono";
  titleSize?: number;
  itemSize?: number;
  detailSize?: number;
  totalSize?: number;
  boldItems?: boolean;
  italicDetails?: boolean;
  separator?: "none" | "solid" | "dashed";
  showItemNotes?: boolean;
  showStaff?: boolean;
  headerFrame?: boolean;
}

export function resolveThermalLayout(config?: ThermalLayoutConfig, kitchen = false, legacySize?: "sm" | "md" | "lg") {
  const size = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  return {
    compact: config?.compact !== false,
    font: config?.font === "mono" ? "'Courier New',monospace" : "Arial,'Segoe UI',sans-serif",
    titleSize: size(config?.titleSize, kitchen ? 22 : 18, 14, 28),
    itemSize: size(config?.itemSize, kitchen ? (legacySize === "sm" ? 14 : legacySize === "lg" ? 22 : 18) : (legacySize === "sm" ? 12 : legacySize === "lg" ? 16 : 14), 12, 24),
    detailSize: size(config?.detailSize, kitchen ? 16 : 12, 11, 20),
    totalSize: size(config?.totalSize, 18, 14, 28),
    boldItems: config?.boldItems !== false,
    italicDetails: config?.italicDetails === true,
    separator: config?.separator === "none" ? "none" : config?.separator === "solid" ? "solid" : "dashed",
    showItemNotes: config?.showItemNotes !== false,
    showStaff: config?.showStaff === true,
    headerFrame: config?.headerFrame === true,
  };
}

