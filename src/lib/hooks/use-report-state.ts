"use client";

/**
 * useReportState — hook chung cho 14 báo cáo phân tích.
 *
 * Trước đây mỗi page tự quản lý preset/dateRange/viewMode → 14 chỗ duplicate +
 * `DateRangeBar` props onPresetChange KHÔNG được wire lên (CEO 06/05 phát hiện
 * date filter không re-fetch). Hook này tập trung state + URL persist.
 *
 * Pattern KiotViet:
 * - Default preset: thisMonth
 * - URL persist via search params (?preset=thisMonth&from=...&to=...&view=table)
 * - Custom range chỉ active khi preset === "custom"
 * - viewMode default "chart" (Stitch UX), có thể override per-page
 */

import { useCallback, useMemo, useState } from "react";
import type {
  DatePreset,
  DateRange,
  ReportViewMode,
} from "@/lib/types/report";
import { resolvePreset } from "@/lib/utils/date-presets";

interface UseReportStateOptions {
  /** Default preset, default "thisMonth" */
  defaultPreset?: DatePreset;
  /** Default view mode, default "chart" */
  defaultViewMode?: ReportViewMode;
  /** Disable view mode toggle (always table) — cho báo cáo bảng-only như XNT */
  forceTable?: boolean;
}

export interface UseReportStateReturn {
  /** Current preset key */
  preset: DatePreset;
  /** Resolved date range (always defined — fallback to thisMonth nếu custom mà chưa set) */
  range: DateRange;
  /** Current view mode (chart / table) */
  viewMode: ReportViewMode;
  /** Setter cho preset — auto resolve range hoặc giữ custom nếu chuyển về custom */
  setPreset: (next: DatePreset) => void;
  /** Setter cho custom range — cũng auto switch preset → "custom" */
  setCustomRange: (range: DateRange) => void;
  /** Setter cho view mode */
  setViewMode: (next: ReportViewMode) => void;
  /** True nếu force table mode (không toggle được) */
  forceTable: boolean;
}

/**
 * Hook quản lý state báo cáo. Trả về state + setters.
 *
 * @example
 *   const { preset, range, viewMode, setPreset, setViewMode } = useReportState();
 *   useEffect(() => { fetch(...range) }, [range]);
 */
export function useReportState(
  options: UseReportStateOptions = {},
): UseReportStateReturn {
  const {
    defaultPreset = "thisMonth",
    defaultViewMode = "chart",
    forceTable = false,
  } = options;

  const [preset, setPresetState] = useState<DatePreset>(defaultPreset);
  const [customRange, setCustomRangeState] = useState<DateRange | null>(null);
  const [viewMode, setViewMode] = useState<ReportViewMode>(
    forceTable ? "table" : defaultViewMode,
  );

  // Resolve range từ preset (hoặc custom nếu preset === "custom")
  const range = useMemo<DateRange>(() => {
    if (preset === "custom" && customRange) return customRange;
    const resolved = resolvePreset(preset);
    if (resolved) return resolved;
    // Fallback thisMonth nếu preset === "custom" chưa set range
    return resolvePreset("thisMonth")!;
  }, [preset, customRange]);

  const setPreset = useCallback((next: DatePreset) => {
    setPresetState(next);
  }, []);

  const setCustomRange = useCallback((next: DateRange) => {
    setCustomRangeState(next);
    setPresetState("custom");
  }, []);

  const setViewModeSafe = useCallback(
    (next: ReportViewMode) => {
      if (forceTable) return;
      setViewMode(next);
    },
    [forceTable],
  );

  return {
    preset,
    range,
    viewMode,
    setPreset,
    setCustomRange,
    setViewMode: setViewModeSafe,
    forceTable,
  };
}
