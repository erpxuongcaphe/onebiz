"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ItemColumn<T> {
  header: string;
  accessor: keyof T | ((item: T) => ReactNode);
  align?: "left" | "center" | "right";
  className?: string;
}

interface DetailItemsTableProps<T> {
  columns: ItemColumn<T>[];
  items: T[];
  /** Summary rows shown below items (e.g. "Tổng tiền hàng", "Giảm giá") */
  summary?: { label: string; value: ReactNode; className?: string }[];
  className?: string;
}

export function DetailItemsTable<T>({
  columns,
  items,
  summary,
  className,
}: DetailItemsTableProps<T>) {
  const alignClass = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            {columns.map((col, idx) => (
              <th
                key={idx}
                className={cn(
                  "px-3 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap",
                  alignClass[col.align || "left"],
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, rowIdx) => (
            <tr key={rowIdx} className="border-t">
              {columns.map((col, colIdx) => {
                const value =
                  typeof col.accessor === "function"
                    ? col.accessor(item)
                    : (item[col.accessor] as ReactNode);
                return (
                  <td
                    key={colIdx}
                    className={cn(
                      "px-3 py-2",
                      alignClass[col.align || "left"],
                      col.className
                    )}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                Không có dữ liệu
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Summary section */}
      {summary && summary.length > 0 && (
        <div className="border-t bg-muted/20 px-3 py-2 space-y-1">
          {summary.map((row, idx) => (
            <div
              key={idx}
              className={cn(
                "flex items-center justify-end gap-4 text-sm",
                row.className
              )}
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-semibold min-w-[120px] text-right">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
