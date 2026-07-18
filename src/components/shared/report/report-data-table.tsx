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

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  /** Key trong T hoặc render function */
  key: keyof T | string;
  /** Stable key used by display preferences and view exports. */
  id?: string;
  /** Set false for columns that must always remain visible. */
  hideable?: boolean;
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
  /** Hiện menu tùy biến cách trình bày bảng. */
  showDisplayOptions?: boolean;
  /** Stable key shared with the matching current-view Excel sheet. */
  tablePreferenceKey?: string;
  /** Number of rows shown on first load. */
  defaultPageSize?: number;
  /** Compact choices shown in the rows-per-page dropdown. */
  pageSizeOptions?: number[];
  /** Only paginate when the result is larger than this value. */
  paginationThreshold?: number;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const DEFAULT_TABLE_PREFERENCES: ReportTablePreferences = {
  density: "standard",
  wrapText: true,
  freezeFirstColumn: false,
  stripedRows: true,
  hiddenColumnKeys: [],
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
  tablePreferenceKey,
  defaultPageSize = 50,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  paginationThreshold = 50,
}: DataTableProps<T>) {
  const pathname = usePathname();
  const preferenceKey = useMemo(
    () =>
      tablePreferenceKey ??
      `${pathname}:${columns
        .map((column, index) => `${String(column.key)}:${index}`)
        .join("|")}`,
    [columns, pathname, tablePreferenceKey],
  );
  const [preferences, setPreferences] = useState<ReportTablePreferences>(
    DEFAULT_TABLE_PREFERENCES,
  );
  const [loadedPreferenceKey, setLoadedPreferenceKey] = useState<string | null>(
    null,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pageState, setPageState] = useState({ key: "", index: 0 });
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const columnEntries = useMemo(
    () =>
      columns.map((column, index) => ({
        column,
        index,
        id: column.id ?? String(column.key),
      })),
    [columns],
  );
  const hiddenColumnKeys = useMemo(
    () => new Set(preferences.hiddenColumnKeys),
    [preferences.hiddenColumnKeys],
  );
  const visibleColumnEntries = useMemo(
    () =>
      columnEntries.filter(
        ({ column, id, index }) =>
          index === 0 || column.hideable === false || !hiddenColumnKeys.has(id),
      ),
    [columnEntries, hiddenColumnKeys],
  );
  const visibleColumnGroups = useMemo(() => {
    if (!columnGroups?.length) return undefined;

    let offset = 0;
    return columnGroups.reduce<ColumnGroup[]>((groups, group) => {
      const start = offset;
      const end = Math.min(offset + group.span, columns.length);
      offset = end;
      const span = visibleColumnEntries.filter(
        ({ index }) => index >= start && index < end,
      ).length;
      if (span > 0) groups.push({ ...group, span });
      return groups;
    }, []);
  }, [columnGroups, columns.length, visibleColumnEntries]);
  const normalizedPageSizeOptions = useMemo(
    () =>
      Array.from(new Set([...pageSizeOptions, defaultPageSize]))
        .filter((size) => Number.isInteger(size) && size > 0)
        .sort((a, b) => a - b),
    [defaultPageSize, pageSizeOptions],
  );
  const showPagination = rows.length > paginationThreshold;
  const resultBoundaryKey =
    rows.length === 0
      ? "empty"
      : [
          getRowKey(rows[0], 0),
          getRowKey(rows[rows.length - 1], rows.length - 1),
          rows.length,
        ].join(":");
  const pageResetKey = [preferenceKey, resultBoundaryKey].join(":");
  const requestedPageIndex =
    pageState.key === pageResetKey ? pageState.index : 0;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePageIndex = Math.min(requestedPageIndex, pageCount - 1);
  const pageStart = showPagination ? safePageIndex * pageSize : 0;
  const pageEnd = showPagination
    ? Math.min(rows.length, pageStart + pageSize)
    : rows.length;
  const pagedRows = showPagination ? rows.slice(pageStart, pageEnd) : rows;


  useEffect(() => {
    if (!showDisplayOptions) return;
    const timer = window.setTimeout(() => {
      const saved = readReportTablePreferences(preferenceKey);
      setPreferences({
        ...DEFAULT_TABLE_PREFERENCES,
        ...saved,
        hiddenColumnKeys: saved.hiddenColumnKeys ?? [],
      });
      setLoadedPreferenceKey(preferenceKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [preferenceKey, showDisplayOptions]);

  useEffect(() => {
    if (!showDisplayOptions || loadedPreferenceKey !== preferenceKey) return;
    writeReportTablePreferences(preferenceKey, preferences);
  }, [loadedPreferenceKey, preferenceKey, preferences, showDisplayOptions]);

  const setColumnVisible = (columnId: string, visible: boolean) => {
    setPreferences((current) => {
      const hidden = new Set(current.hiddenColumnKeys);
      if (visible) hidden.delete(columnId);
      else hidden.add(columnId);
      return { ...current, hiddenColumnKeys: Array.from(hidden) };
    });
  };

  const showAllColumns = () => {
    setPreferences((current) => ({ ...current, hiddenColumnKeys: [] }));
  };

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
    <div className={cn("min-w-0", className)}>
      {showDisplayOptions && (
        <div className="sticky left-0 z-20 flex min-h-9 min-w-full items-center justify-end border-b border-border/60 px-2 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:bg-surface-container hover:text-foreground">
              <Icon name="tune" size={14} />
              Hiển thị bảng
              <Icon name="expand_more" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>Mật độ bảng</DropdownMenuLabel>
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
                  Tiêu chuẩn
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">
                  Gọn
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Cách trình bày</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={preferences.wrapText}
                onCheckedChange={(checked) =>
                  setPreferences((current) => ({
                    ...current,
                    wrapText: checked === true,
                  }))
                }
              >
                Xuống dòng nội dung dài
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
                Cố định cột đầu
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
                Kẻ dòng xen kẽ
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Icon name="view_column" size={14} />
                  Cột hiển thị
                  <span className="ml-auto mr-1 text-xs text-muted-foreground">
                    {visibleColumnEntries.length}/{columns.length}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-64 max-h-[70vh] overflow-y-auto">
                  <DropdownMenuLabel>Chọn cột trên bảng</DropdownMenuLabel>
                  {columnEntries.map(({ column, id, index }) => {
                    const required = index === 0 || column.hideable === false;
                    const visible = required || !hiddenColumnKeys.has(id);
                    return (
                      <DropdownMenuCheckboxItem
                        key={id}
                        checked={visible}
                        disabled={required}
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          setColumnVisible(id, checked === true)
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">{column.label}</span>
                        {required && (
                          <span className="text-[10px] text-muted-foreground">
                            Bắt buộc
                          </span>
                        )}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={preferences.hiddenColumnKeys.length === 0}
                    closeOnClick={false}
                    onSelect={showAllColumns}
                  >
                    <Icon name="select_all" size={14} />
                    Hiện tất cả cột
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={resetDisplay}>
                <Icon name="restart_alt" size={14} />
                Khôi phục mặc định
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="min-w-0 overflow-x-auto">
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
          {visibleColumnGroups && visibleColumnGroups.length > 0 && (
            <tr className="bg-surface-container">
              {hasExpand && <th className="w-8"></th>}
              {visibleColumnGroups.map((g, i) => (
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
            {visibleColumnEntries.map(({ column: col, id, index: originalIndex }) => (
              <th
                key={id}
                className={cn(
                  cellPadding,
                  "text-xs font-semibold text-foreground",
                  !preferences.wrapText && "whitespace-nowrap",
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  (!col.align || col.align === "left") && "text-left",
                  isStickyColumn(col, originalIndex) &&
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
              {visibleColumnEntries.map(({ column: col, id, index: originalIndex }, i) => (
                <td
                  key={id}
                  className={cn(
                    cellPadding,
                    "text-xs text-foreground tabular-nums",
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                    (!col.align || col.align === "left") && "text-left",
                    isStickyColumn(col, originalIndex) &&
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
                colSpan={visibleColumnEntries.length + (hasExpand ? 1 : 0)}
                className="text-center py-8 text-sm text-muted-foreground"
              >
                {emptyState ?? "Chưa có dữ liệu"}
              </td>
            </tr>
          ) : (
            pagedRows.map((row, idx) => {
              const absoluteIndex = pageStart + idx;
              const key = String(getRowKey(row, absoluteIndex));
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
                        absoluteIndex % 2 === 1 &&
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
                    {visibleColumnEntries.map(({ column: col, id, index: originalIndex }) => (
                      <td
                        key={id}
                        className={cn(
                          cellPadding,
                          "text-xs tabular-nums",
                          col.align === "right" && "text-right",
                          col.align === "center" && "text-center",
                          (!col.align || col.align === "left") && "text-left",
                          isStickyColumn(col, originalIndex) &&
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
                        {visibleColumnEntries.map(({ column: col, id, index: originalIndex }, visibleIndex) => (
                          <td
                            key={id}
                            className={cn(
                              subRowPadding,
                              "text-xs tabular-nums text-muted-foreground italic",
                              col.align === "right" && "text-right",
                              col.align === "center" && "text-center",
                              (!col.align || col.align === "left") && "text-left",
                              visibleIndex === 0 && "pl-6",
                              isStickyColumn(col, originalIndex) &&
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
      {showPagination && (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            Hiển thị {pageStart + 1}–{pageEnd} trên {rows.length} dòng
          </span>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Số dòng</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPageState({ key: pageResetKey, index: 0 });
              }}
            >
              <SelectTrigger
                size="sm"
                className="min-w-20 bg-background text-xs"
                aria-label="Số dòng mỗi trang"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {normalizedPageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} dòng
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePageIndex === 0}
              onClick={() =>
                setPageState({
                  key: pageResetKey,
                  index: safePageIndex - 1,
                })
              }
              aria-label="Trang trước"
              title="Trang trước"
            >
              <Icon name="chevron_left" size={18} />
            </Button>
            <span className="min-w-14 text-center tabular-nums text-foreground">
              {safePageIndex + 1}/{pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePageIndex >= pageCount - 1}
              onClick={() =>
                setPageState({
                  key: pageResetKey,
                  index: safePageIndex + 1,
                })
              }
              aria-label="Trang sau"
              title="Trang sau"
            >
              <Icon name="chevron_right" size={18} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
