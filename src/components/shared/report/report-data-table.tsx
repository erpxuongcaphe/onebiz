"use client";

/**
 * ReportDataTable — bảng số liệu universal cho báo cáo.
 *
 * Pattern KiotViet (CEO 06/05/2026):
 * - Header row light blue background (`bg-primary-fixed/30`)
 * - Subtotal row (vd "SL mặt hàng: 201") highlight ở top
 * - Column groups merged header (NHẬP / XUẤT)
 * - Expandable rows với "+" icon (cho XNT chi tiết theo chi nhánh)
 * - Right-align số, left-align text
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

export type ColumnAlign = "left" | "center" | "right";

export interface DataTableColumn<T> {
  /** Header label */
  label: string;
  /** Key trong T hoặc render function */
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
  /** Group label hiển thị trên row 1 */
  label: string;
  /** Số column con thuộc group này */
  span: number;
  /** Header cell color */
  variant?: "default" | "input" | "output";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Column groups (optional) — render thêm 1 row merged header phía trên */
  columnGroups?: ColumnGroup[];
  /** Row key extractor */
  getRowKey: (row: T, index: number) => string | number;
  /** Subtotal label hiển thị ở row đầu (vd "SL mặt hàng: 201") */
  subtotalLabel?: string;
  /** Empty state */
  emptyState?: ReactNode;
  /** Click row → expand sub-rows (cho XNT theo chi nhánh) */
  getSubRows?: (row: T) => T[] | undefined;
  /** Class name override */
  className?: string;
}

export function ReportDataTable<T>({
  columns,
  rows,
  columnGroups,
  getRowKey,
  subtotalLabel,
  emptyState,
  getSubRows,
  className,
}: DataTableProps<T>) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hasExpand = !!getSubRows;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm border-collapse">
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
                    "px-3 py-2 text-xs font-semibold text-center border-b border-border",
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
                  "px-3 py-2 text-xs font-semibold text-foreground whitespace-nowrap",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  (!col.align || col.align === "left") && "text-left",
                  col.sticky && "sticky left-0 bg-primary-fixed/40 z-10",
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
                    "px-3 py-2 text-xs text-foreground tabular-nums",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    (!col.align || col.align === "left") && "text-left",
                    col.sticky && "sticky left-0 bg-primary-fixed/20 z-10",
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
                {emptyState ?? "Chưa có dữ liệu"}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const key = String(getRowKey(row, idx));
              const subRows = getSubRows?.(row);
              const hasSubRows = subRows && subRows.length > 0;
              const isExpanded = expanded[key];
              return (
                <>
                  <tr
                    key={key}
                    className={cn(
                      "border-b border-border/50 hover:bg-surface-container/50 transition-colors",
                      idx % 2 === 1 && "bg-surface-container-low/20",
                    )}
                  >
                    {hasExpand && (
                      <td className="w-8 px-2 sticky left-0 bg-inherit">
                        {hasSubRows && (
                          <button
                            onClick={() => toggleExpand(key)}
                            className="p-0.5 rounded hover:bg-surface-container"
                            aria-label={isExpanded ? "Thu gọn" : "Mở rộng"}
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
                          "px-3 py-2 text-xs tabular-nums",
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          (!col.align || col.align === "left") && "text-left",
                          col.sticky && "sticky left-0 bg-inherit z-10",
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
                              "px-3 py-1.5 text-xs tabular-nums text-muted-foreground italic",
                              col.align === "right" && "text-right",
                              col.align === "center" && "text-center",
                              (!col.align || col.align === "left") && "text-left",
                              ci === 0 && "pl-6",
                              col.sticky && "sticky left-0 bg-surface-container-low/40 z-10",
                            )}
                          >
                            {col.cell
                              ? col.cell(subRow)
                              : String((subRow as Record<string, unknown>)[String(col.key)] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                </>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
