"use client";

/**
 * ReportDataTable â€” báº£ng sá»‘ liá»‡u universal cho bÃ¡o cÃ¡o.
 *
 * Pattern KiotViet (CEO 06/05/2026):
 * - Header row light blue background (`bg-primary-fixed/30`)
 * - Subtotal row (vd "SL máº·t hÃ ng: 201") highlight á»Ÿ top
 * - Column groups merged header (NHáº¬P / XUáº¤T)
 * - Expandable rows vá»›i "+" icon (cho XNT chi tiáº¿t theo chi nhÃ¡nh)
 * - Right-align sá»‘, left-align text
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clearReportTablePreferences,
  readReportTablePreferences,
  writeReportTablePreferences,
  type ReportTablePreferences,
} from "@/lib/reports/preferences";

export type ColumnAlign = "left" | "center" | "right";

export interface DataTableColumn<T> {
  /** Header label */
  label: string;
  /** Key trong T hoáº·c render function */
  key: keyof T | string;
  /** Custom cell renderer (override default) */
  cell?: (row: T) => ReactNode;
  /** Subtotal cell renderer (footer/header subtotal) */
  subtotalCell?: ReactNode;
  align?: ColumnAlign;
  /** Width style (vd "120px", "10%") */
  width?: string;
  /** Sticky left cho freeze */
  sticky?: boolean;
}

export interface ColumnGroup {
  /** Group label hiá»ƒn thá»‹ trÃªn row 1 */
  label: string;
  /** Sá»‘ column con thuá»™c group nÃ y */
  span: number;
  /** Header cell color */
  variant?: "default" | "input" | "output";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Column groups (optional) â€” render thÃªm 1 row merged header phÃ­a trÃªn */
  columnGroups?: ColumnGroup[];
  /** Row key extractor */
  getRowKey: (row: T, index: number) => string | number;
  /** Subtotal label hiá»ƒn thá»‹ á»Ÿ row Ä‘áº§u (vd "SL máº·t hÃ ng: 201") */
  subtotalLabel?: string;
  /** Empty state */
  emptyState?: ReactNode;
  /** Click row â†’ expand sub-rows (cho XNT theo chi nhÃ¡nh) */
  getSubRows?: (row: T) => T[] | undefined;
  /** Class name override */
  className?: string;
  /** Hiá»‡n menu tÃ¹y biáº¿n cÃ¡ch trÃ¬nh bÃ y báº£ng. */
  showDisplayOptions?: boolean;
}

const DEFAULT_TABLE_PREFERENCES: ReportTablePreferences = {
  density: "standard",
  wrapText: true,
  freezeFirstColumn: false,
  stripedRows: true,
};

export function ReportDataTable<T>({
  columns,
  rows,
  columnGroups,
  getRowKey,
  subtotalLabel,
  emptyState,
  getSubRows,
  className,
  showDisplayOptions = true,
}: DataTableProps<T>) {
  const pathname = usePathname();
  const preferenceKey = useMemo(
    () =>
      `${pathname}:${columns
        .map((column, index) => `${String(column.key)}:${index}`)
        .join("|")}`,
    [columns, pathname],
  );
  const [preferences, setPreferences] = useState<ReportTablePreferences>(
    DEFAULT_TABLE_PREFERENCES,
  );
  const [loadedPreferenceKey, setLoadedPreferenceKey] = useState<string | null>(
    null,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!showDisplayOptions) return;
    const timer = window.setTimeout(() => {
      const saved = readReportTablePreferences(preferenceKey);
      setPreferences({ ...DEFAULT_TABLE_PREFERENCES, ...saved });
      setLoadedPreferenceKey(preferenceKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [preferenceKey, showDisplayOptions]);

  useEffect(() => {
    if (!showDisplayOptions || loadedPreferenceKey !== preferenceKey) return;
    writeReportTablePreferences(preferenceKey, preferences);
  }, [loadedPreferenceKey, preferenceKey, preferences, showDisplayOptions]);

  const resetDisplay = () => {
    clearReportTablePreferences(preferenceKey);
    setPreferences(DEFAULT_TABLE_PREFERENCES);
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hasExpand = !!getSubRows;
  const cellPadding =
    preferences.density === "compact" ? "px-2 py-1.5" : "px-3 py-2";
  const subRowPadding =
    preferences.density === "compact" ? "px-2 py-1" : "px-3 py-1.5";
  const isStickyColumn = (column: DataTableColumn<T>, index: number) =>
    column.sticky ||
    (preferences.freezeFirstColumn && index === 0 && !hasExpand);

  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      {showDisplayOptions && (
        <div className="sticky left-0 z-20 flex min-h-9 min-w-full items-center justify-end border-b border-border/60 px-2 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-surface-container hover:text-foreground">
              <Icon name="tune" size={14} />
              Hiá»ƒn thá»‹ báº£ng
              <Icon name="expand_more" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>Máº­t Ä‘á»™ báº£ng</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={preferences.density}
                onValueChange={(value) => {
                  if (value === "standard" || value === "compact") {
                    setPreferences((current) => ({
                      ...current,
                      density: value,
                    }));
                  }
                }}
              >
                <DropdownMenuRadioItem value="standard">
                  TiÃªu chuáº©n
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">
                  Gá»n
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>CÃ¡ch trÃ¬nh bÃ y</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={preferences.wrapText}
                onCheckedChange={(checked) =>
                  setPreferences((current) => ({
                    ...current,
                    wrapText: checked === true,
                  }))
                }
              >
                Xuá»‘ng dÃ²ng ná»™i dung dÃ i
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={preferences.freezeFirstColumn}
                disabled={hasExpand}
                onCheckedChange={(checked) =>
                  setPreferences((current) => ({
                    ...current,
                    freezeFirstColumn: checked === true,
                  }))
                }
              >
                Cá»‘ Ä‘á»‹nh cá»™t Ä‘áº§u
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={preferences.stripedRows}
                onCheckedChange={(checked) =>
                  setPreferences((current) => ({
                    ...current,
                    stripedRows: checked === true,
                  }))
                }
              >
                Káº» dÃ²ng xen káº½
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={resetDisplay}>
                <Icon name="restart_alt" size={14} />
                KhÃ´i phá»¥c máº·c Ä‘á»‹nh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <table
        className={cn(
          "w-full border-collapse text-sm",
          preferences.wrapText
            ? "[&_td]:whitespace-normal"
            : "[&_td]:whitespace-nowrap",
        )}
      >
        <thead>
          {/* Column groups header (optional) */}
          {columnGroups && columnGroups.length > 0 && (
            <tr className="bg-surface-container">
              {hasExpand && <th className="w-8"></th>}
              {columnGroups.map((g, i) => (
                <th
                  key={i}
                  colSpan={g.span}
                  className={cn(
                    cellPadding,
                    "border-b border-border text-center text-xs font-semibold",
                    g.variant === "input" &&
                      "bg-status-success/15 text-status-success",
                    g.variant === "output" &&
                      "bg-status-warning/15 text-status-warning",
                  )}
                >
                  {g.label}
                </th>
              ))}
            </tr>
          )}
          {/* Column header row */}
          <tr className="bg-primary-fixed/40 border-b border-border">
            {hasExpand && <th className="w-8 sticky left-0 bg-primary-fixed/40"></th>}
            {columns.map((col, i) => (
              <th
                key={i}
                className={cn(
                  cellPadding,
                  "text-xs font-semibold text-foreground",
                  !preferences.wrapText && "whitespace-nowrap",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  (!col.align || col.align === "left") && "text-left",
                  isStickyColumn(col, i) &&
                    "sticky left-0 z-10 bg-primary-fixed/40",
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Subtotal row (top) */}
          {subtotalLabel && (
            <tr className="bg-primary-fixed/20 font-bold border-b border-border">
              {hasExpand && <td className="w-8 sticky left-0 bg-primary-fixed/20"></td>}
              {columns.map((col, i) => (
                <td
                  key={i}
                  className={cn(
                    cellPadding,
                    "text-xs text-foreground tabular-nums",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    (!col.align || col.align === "left") && "text-left",
                    isStickyColumn(col, i) &&
                      "sticky left-0 z-10 bg-primary-fixed/20",
                  )}
                >
                  {i === 0 ? subtotalLabel : col.subtotalCell ?? ""}
                </td>
              ))}
            </tr>
          )}
          {/* Data rows */}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (hasExpand ? 1 : 0)}
                className="text-center py-8 text-sm text-muted-foreground"
              >
                {emptyState ?? "ChÆ°a cÃ³ dá»¯ liá»‡u"}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const key = String(getRowKey(row, idx));
              const subRows = getSubRows?.(row);
              const hasSubRows = subRows && subRows.length > 0;
              const isExpanded = expanded[key];
              return (
                <Fragment key={key}>
                  <tr
                    key={key}
                    className={cn(
                      "border-b border-border/50 hover:bg-surface-container/50 transition-colors",
                      preferences.stripedRows &&
                        idx % 2 === 1 &&
                        "bg-surface-container-low/20",
                    )}
                  >
                    {hasExpand && (
                      <td className="w-8 px-2 sticky left-0 bg-inherit">
                        {hasSubRows && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(key)}
                            aria-expanded={isExpanded}
                            className="p-0.5 rounded hover:bg-surface-container"
                            aria-label={isExpanded ? "Thu gá»n" : "Má»Ÿ rá»™ng"}
                          >
                            <Icon
                              name={
                                isExpanded ? "indeterminate_check_box" : "add_box"
                              }
                              size={16}
                              className="text-primary"
                            />
                          </button>
                        )}
                      </td>
                    )}
                    {columns.map((col, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          cellPadding,
                          "text-xs tabular-nums",
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          (!col.align || col.align === "left") && "text-left",
                          isStickyColumn(col, ci) &&
                            "sticky left-0 z-10 bg-inherit",
                        )}
                      >
                        {col.cell
                          ? col.cell(row)
                          : String((row as Record<string, unknown>)[String(col.key)] ?? "")}
                      </td>
                    ))}
                  </tr>
                  {/* Sub-rows (expanded) */}
                  {hasSubRows &&
                    isExpanded &&
                    subRows!.map((subRow, si) => (
                      <tr
                        key={`${key}-sub-${si}`}
                        className="bg-surface-container-low/40 border-b border-border/30"
                      >
                        {hasExpand && <td className="w-8 sticky left-0 bg-surface-container-low/40"></td>}
                        {columns.map((col, ci) => (
                          <td
                            key={ci}
                            className={cn(
                              subRowPadding,
                              "text-xs tabular-nums text-muted-foreground italic",
                              col.align === "right" && "text-right",
                              col.align === "center" && "text-center",
                              (!col.align || col.align === "left") && "text-left",
                              ci === 0 && "pl-6",
                              isStickyColumn(col, ci) &&
                                "sticky left-0 z-10 bg-surface-container-low/40",
                            )}
                          >
                            {col.cell
                              ? col.cell(subRow)
                              : String((subRow as Record<string, unknown>)[String(col.key)] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

