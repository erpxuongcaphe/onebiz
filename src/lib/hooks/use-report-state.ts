"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DatePreset,
  DateRange,
  ReportViewMode,
} from "@/lib/types/report";
import { DATE_PRESETS, resolvePreset } from "@/lib/utils/date-presets";

interface UseReportStateOptions {
  defaultPreset?: DatePreset;
  defaultViewMode?: ReportViewMode;
  forceTable?: boolean;
}

export interface UseReportStateReturn {
  preset: DatePreset;
  range: DateRange;
  viewMode: ReportViewMode;
  setPreset: (next: DatePreset) => void;
  setCustomRange: (range: DateRange) => void;
  setViewMode: (next: ReportViewMode) => void;
  forceTable: boolean;
}

const VALID_PRESETS = new Set<DatePreset>([
  ...DATE_PRESETS.map((preset) => preset.key),
  "custom",
]);
const VALID_VIEWS = new Set<ReportViewMode>(["chart", "table"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateRange(from: string | null, to: string | null): boolean {
  return (
    !!from &&
    !!to &&
    ISO_DATE_PATTERN.test(from) &&
    ISO_DATE_PATTERN.test(to) &&
    from <= to
  );
}

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
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPreset = params.get("preset") as DatePreset | null;
    const requestedView = params.get("view") as ReportViewMode | null;
    const from = params.get("from");
    const to = params.get("to");
    const hasCustomRange = isValidDateRange(from, to);

    if (
      requestedPreset &&
      VALID_PRESETS.has(requestedPreset) &&
      (requestedPreset !== "custom" || hasCustomRange)
    ) {
      setPresetState(requestedPreset);
    }
    if (hasCustomRange) {
      setCustomRangeState({ from: from!, to: to! });
    }
    if (!forceTable && requestedView && VALID_VIEWS.has(requestedView)) {
      setViewMode(requestedView);
    }
    setUrlReady(true);
  }, [forceTable]);

  const range = useMemo<DateRange>(() => {
    if (preset === "custom" && customRange) return customRange;
    return resolvePreset(preset) ?? resolvePreset("thisMonth")!;
  }, [customRange, preset]);

  useEffect(() => {
    if (!urlReady) return;

    const url = new URL(window.location.href);
    url.searchParams.set("preset", preset);
    url.searchParams.set("view", viewMode);
    if (preset === "custom") {
      url.searchParams.set("from", range.from);
      url.searchParams.set("to", range.to);
    } else {
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    }
    window.history.replaceState(window.history.state, "", url);
  }, [preset, range.from, range.to, urlReady, viewMode]);

  const setPreset = useCallback((next: DatePreset) => {
    setPresetState(next);
  }, []);

  const setCustomRange = useCallback((next: DateRange) => {
    setCustomRangeState(next);
    setPresetState("custom");
  }, []);

  const setViewModeSafe = useCallback(
    (next: ReportViewMode) => {
      if (!forceTable) setViewMode(next);
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
