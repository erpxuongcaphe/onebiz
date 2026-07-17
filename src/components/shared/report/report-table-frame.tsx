"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import {
  ReportTableDisplayMenu,
  useReportTableDisplayPreferences,
  type ReportTableDisplayColumn,
} from "./report-table-display";

interface ReportTableFrameProps {
  tablePreferenceKey: string;
  children: ReactNode;
  className?: string;
  /** Disable column hiding for tables with merged cells that cannot be resized safely. */
  allowColumnSelection?: boolean;
}

function sameColumns(
  left: ReportTableDisplayColumn[],
  right: ReportTableDisplayColumn[],
) {
  return (
    left.length === right.length &&
    left.every(
      (column, index) =>
        column.id === right[index]?.id &&
        column.label === right[index]?.label &&
        column.required === right[index]?.required,
    )
  );
}

/**
 * Adds persistent display controls to existing report tables without changing
 * their rows, queries, formulas or export data.
 */
export function ReportTableFrame({
  tablePreferenceKey,
  children,
  className,
  allowColumnSelection = true,
}: ReportTableFrameProps) {
  const scopeId =
    "report-table-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tableRootRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<ReportTableDisplayColumn[]>([]);
  const [hasMergedCells, setHasMergedCells] = useState(false);
  const { preferences, setPreferences, resetDisplay } =
    useReportTableDisplayPreferences(tablePreferenceKey);

  useEffect(() => {
    const root = tableRootRef.current;
    if (!root) return;

    const readColumns = () => {
      const headerCells = Array.from(
        root.querySelectorAll<HTMLTableCellElement>(
          "table:first-of-type > thead > tr:last-child > th",
        ),
      );
      const nextColumns = headerCells.map((cell, index) => ({
        id: "column-" + (index + 1),
        label:
          cell.textContent?.replace(/\s+/g, " ").trim() ||
          "C\u1ed9t " + (index + 1),
        required: index === 0,
      }));
      setColumns((current) =>
        sameColumns(current, nextColumns) ? current : nextColumns,
      );
      const mergedCells = Array.from(
        root.querySelectorAll<HTMLTableCellElement>(
          "table:first-of-type th[colspan], table:first-of-type td[colspan]",
        ),
      ).some((cell) => cell.colSpan > 1);
      const hasGroupedHeader =
        root.querySelectorAll("table:first-of-type > thead > tr").length > 1;
      setHasMergedCells(mergedCells || hasGroupedHeader);
    };

    readColumns();
    const observer = new MutationObserver(readColumns);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);

  const canSelectColumns = allowColumnSelection && !hasMergedCells;
  const hiddenIndexes = useMemo(() => {
    if (!canSelectColumns) return [];
    const hidden = new Set(preferences.hiddenColumnKeys);
    return columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => !column.required && hidden.has(column.id))
      .map(({ index }) => index + 1);
  }, [canSelectColumns, columns, preferences.hiddenColumnKeys]);

  const scopedSelector = '[data-report-table-scope="' + scopeId + '"]';
  const hiddenCss = hiddenIndexes
    .map(
      (index) =>
        scopedSelector +
        " table:first-of-type > thead > tr:last-child > :nth-child(" +
        index +
        ")," +
        scopedSelector +
        " table:first-of-type > tbody > tr > :nth-child(" +
        index +
        ")," +
        scopedSelector +
        " table:first-of-type > tfoot > tr > :nth-child(" +
        index +
        "){display:none!important;}",
    )
    .join("\n");
  const compactCss =
    preferences.density === "compact"
      ? scopedSelector +
        " table:first-of-type th," +
        scopedSelector +
        " table:first-of-type td{padding:.375rem .5rem!important;}"
      : "";
  const wrapCss =
    scopedSelector +
    " table:first-of-type th," +
    scopedSelector +
    " table:first-of-type td{white-space:" +
    (preferences.wrapText ? "normal" : "nowrap") +
    "!important;}";
  const stripedCss = preferences.stripedRows
    ? scopedSelector +
      " table:first-of-type > tbody > tr:nth-child(even)>*" +
      "{background-color:var(--surface-container-low)!important;}"
    : "";
  const freezeCss = preferences.freezeFirstColumn
    ? scopedSelector +
      " table:first-of-type > thead > tr > :first-child," +
      scopedSelector +
      " table:first-of-type > tbody > tr > :first-child," +
      scopedSelector +
      " table:first-of-type > tfoot > tr > :first-child" +
      "{position:sticky;left:0;z-index:2;" +
      "background-color:var(--surface-container-lowest);}" +
      scopedSelector +
      " table:first-of-type > thead > tr > :first-child" +
      "{z-index:3;background-color:var(--surface-container);}"
    : "";

  return (
    <div className={cn("min-w-0", className)}>
      <ReportTableDisplayMenu
        columns={canSelectColumns ? columns : []}
        preferences={preferences}
        setPreferences={setPreferences}
        onReset={resetDisplay}
      />
      <div
        ref={tableRootRef}
        data-report-table-scope={scopeId}
        className="min-w-0 overflow-x-auto"
      >
        <style>{hiddenCss + compactCss + wrapCss + stripedCss + freezeCss}</style>
        {children}
      </div>
    </div>
  );
}

