"use client";

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  RowSelectionState,
  VisibilityState,
  Row,
} from "@tanstack/react-table";
import { useState, useMemo, useEffect, ReactNode, Fragment } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Settings2,
  X,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "./pagination";

export interface RowAction<TData> {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
  separator?: boolean;
}

export interface BulkAction<TData> {
  label: string;
  icon?: ReactNode;
  onClick: (selectedRows: TData[]) => void;
  variant?: "default" | "destructive";
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  loading?: boolean;
  pageCount?: number;
  pageIndex?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  total?: number;
  selectable?: boolean;
  summaryRow?: Record<string, string | number>;
  onRowClick?: (row: TData, index: number) => void;
  rowActions?: (row: TData) => RowAction<TData>[];
  bulkActions?: BulkAction<TData>[];
  columnToggle?: boolean;
  /** Inline detail panel — render function receives the row data */
  renderDetail?: (row: TData, onClose: () => void) => ReactNode;
  /** Currently expanded row index (controlled) */
  expandedRow?: number | null;
  /** Callback when expanded row changes */
  onExpandedRowChange?: (index: number | null) => void;
  /** Get unique row ID for tracking (defaults to index) */
  getRowId?: (row: TData) => string;
  /**
   * Counter prop — bất kỳ thay đổi nào về số sẽ buộc DataTable
   * gọi `toggleAllRowsSelected(false)` để xoá toàn bộ checkbox đã chọn.
   * Dùng sau khi parent thực thi xong một bulk action thành công.
   */
  clearSelectionTrigger?: number;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  pageCount = 1,
  pageIndex = 0,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  total = 0,
  selectable = false,
  summaryRow,
  onRowClick,
  rowActions,
  bulkActions,
  columnToggle = false,
  renderDetail,
  expandedRow: controlledExpanded,
  onExpandedRowChange,
  getRowId,
  clearSelectionTrigger,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [internalExpanded, setInternalExpanded] = useState<number | null>(null);

  const expandedRowIdx =
    controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const setExpandedRowIdx = onExpandedRowChange || setInternalExpanded;

  // Build the full column list with optional select + actions columns
  const allColumns = useMemo(() => {
    const cols: ColumnDef<TData, TValue>[] = [];

    if (selectable) {
      cols.push({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        size: 40,
        enableSorting: false,
        enableHiding: false,
      } as ColumnDef<TData, TValue>);
    }

    cols.push(...columns);

    if (rowActions) {
      cols.push({
        id: "actions",
        header: "",
        size: 48,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const actions = rowActions(row.original);
          if (!actions || actions.length === 0) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                <span className="sr-only">Mở menu</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
                {actions.map((action, idx) => (
                  <Fragment key={idx}>
                    {action.separator && idx > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      variant={action.variant}
                      onClick={(e) => {
                        e.stopPropagation();
                        action.onClick();
                      }}
                    >
                      {action.icon && (
                        <span className="mr-1.5">{action.icon}</span>
                      )}
                      {action.label}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      } as ColumnDef<TData, TValue>);
    }

    return cols;
  }, [columns, selectable, rowActions]);

  const table = useReactTable<TData>({
    data,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columns: allColumns as any,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    manualPagination: true,
    pageCount,
    state: {
      sorting,
      rowSelection,
      columnVisibility,
      pagination: { pageIndex, pageSize },
    },
    ...(getRowId ? { getRowId: (row) => getRowId(row) } : {}),
  });

  // Reset selection externally — parent ↑ trigger sau khi bulk action xong
  useEffect(() => {
    if (clearSelectionTrigger === undefined) return;
    table.toggleAllRowsSelected(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSelectionTrigger]);

  // Derive selected rows for bulk actions
  const selectedRows = useMemo(() => {
    return table
      .getRowModel()
      .rows.filter((row) => row.getIsSelected())
      .map((row) => row.original);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, data]);

  const selectedCount = Object.keys(rowSelection).filter(
    (key) => rowSelection[key]
  ).length;

  // Toggleable columns (exclude select and actions)
  const toggleableColumns = table
    .getAllColumns()
    .filter((col) => col.getCanHide());

  const totalColSpan = allColumns.length;

  const handleRowClick = (row: TData, index: number) => {
    if (renderDetail) {
      setExpandedRowIdx(expandedRowIdx === index ? null : index);
    }
    onRowClick?.(row, index);
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* Column visibility toggle */}
      {columnToggle && toggleableColumns.length > 0 && (
        <div className="flex justify-end px-4 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Hiển thị cột</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
              <DropdownMenuLabel>Chọn cột hiển thị</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map((column) => {
                const headerDef = column.columnDef.header;
                const label =
                  typeof headerDef === "string" ? headerDef : column.id;
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-muted/50 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "text-xs font-semibold text-muted-foreground whitespace-nowrap",
                      header.column.getCanSort() &&
                        "cursor-pointer select-none"
                    )}
                    style={{
                      width:
                        header.getSize() !== 150
                          ? header.getSize()
                          : undefined,
                    }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                      {header.column.getCanSort() && (
                        <span className="text-muted-foreground/50">
                          {header.column.getIsSorted() === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {/* Summary row */}
            {summaryRow && (
              <TableRow className="bg-muted/30 font-semibold hover:bg-muted/30">
                {table
                  .getHeaderGroups()[0]
                  ?.headers.map((header) => {
                    const id = header.column.id;
                    return (
                      <TableCell key={header.id} className="text-sm">
                        {id && summaryRow[id] !== undefined
                          ? summaryRow[id]
                          : ""}
                      </TableCell>
                    );
                  })}
              </TableRow>
            )}

            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {table
                    .getHeaderGroups()[0]
                    ?.headers.map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={totalColSpan}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-16 w-16 rounded-full bg-blue-50 flex items-center justify-center">
                      <svg
                        className="h-8 w-8 text-blue-300"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <p className="font-medium">Không tìm thấy kết quả</p>
                    <p className="text-xs">
                      Không tìm thấy giao dịch nào phù hợp.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row, rowIndex) => (
                <Fragment key={row.id}>
                  <TableRow
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(
                      (onRowClick || renderDetail) && "cursor-pointer",
                      expandedRowIdx === rowIndex &&
                        "bg-blue-50/60 border-l-2 border-l-[hsl(217,91%,40%)]"
                    )}
                    onClick={() => handleRowClick(row.original, rowIndex)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="text-sm py-2.5">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>

                  {/* Inline detail panel */}
                  {renderDetail && expandedRowIdx === rowIndex && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={totalColSpan}
                        className="p-0 border-l-2 border-l-[hsl(217,91%,40%)]"
                      >
                        {renderDetail(row.original, () =>
                          setExpandedRowIdx(null)
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden flex-1 overflow-auto p-3 space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-card rounded-lg border p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))
        ) : data.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <div className="flex flex-col items-center gap-2">
              <div className="h-16 w-16 rounded-full bg-blue-50 flex items-center justify-center">
                <svg
                  className="h-8 w-8 text-blue-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="font-medium">Không tìm thấy kết quả</p>
            </div>
          </div>
        ) : (
          table.getRowModel().rows.map((row, rowIndex) => (
            <Fragment key={row.id}>
              <div
                className={cn(
                  "bg-card rounded-lg border p-3",
                  (onRowClick || renderDetail) &&
                    "cursor-pointer active:bg-muted/50",
                  expandedRowIdx === rowIndex &&
                    "ring-2 ring-[hsl(217,91%,40%)] bg-blue-50/30"
                )}
                onClick={() => handleRowClick(row.original, rowIndex)}
              >
                {/* Mobile: selection checkbox + action menu in top row */}
                {(selectable || rowActions) && (
                  <div className="flex items-center justify-between mb-2">
                    {selectable ? (
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(value) =>
                          row.toggleSelected(!!value)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div />
                    )}
                    {rowActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          side="bottom"
                          sideOffset={4}
                        >
                          {rowActions(row.original).map((action, idx) => (
                            <Fragment key={idx}>
                              {action.separator && idx > 0 && (
                                <DropdownMenuSeparator />
                              )}
                              <DropdownMenuItem
                                variant={action.variant}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  action.onClick();
                                }}
                              >
                                {action.icon && (
                                  <span className="mr-1.5">
                                    {action.icon}
                                  </span>
                                )}
                                {action.label}
                              </DropdownMenuItem>
                            </Fragment>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}

                {/* Mobile: data fields */}
                <div className="space-y-1">
                  {row.getVisibleCells().map((cell) => {
                    if (
                      cell.column.id === "select" ||
                      cell.column.id === "actions" ||
                      cell.column.id === "star"
                    )
                      return null;
                    const header = cell.column.columnDef.header;
                    const headerText =
                      typeof header === "string" ? header : "";
                    return (
                      <div
                        key={cell.id}
                        className="flex items-center justify-between text-sm"
                      >
                        {headerText && (
                          <span className="text-muted-foreground text-xs">
                            {headerText}
                          </span>
                        )}
                        <span className="font-medium">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mobile inline detail */}
              {renderDetail && expandedRowIdx === rowIndex && (
                <div className="bg-white border rounded-lg -mt-1 overflow-hidden">
                  {renderDetail(row.original, () => setExpandedRowIdx(null))}
                </div>
              )}
            </Fragment>
          ))
        )}
      </div>

      {/* Pagination — KiotViet style: "Hiển thị X dòng" */}
      {total > 0 && (
        <DataTablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageCount={pageCount}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}

      {/* Bulk action bar */}
      {selectable &&
        selectedCount > 0 &&
        bulkActions &&
        bulkActions.length > 0 && (
          <div
            className={cn(
              "fixed bottom-0 left-0 right-0 z-50 md:left-auto md:right-4 md:bottom-4 md:max-w-xl md:rounded-lg",
              "bg-foreground text-background shadow-2xl",
              "transform transition-all duration-300 ease-out",
              "animate-in slide-in-from-bottom-4 fade-in-0"
            )}
          >
            <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
              <span className="text-sm font-medium whitespace-nowrap">
                Đã chọn {selectedCount} mục
              </span>

              <div className="h-4 w-px bg-background/20 mx-1 hidden sm:block" />

              <div className="flex items-center gap-1.5 flex-wrap">
                {bulkActions.map((action, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      action.variant === "destructive"
                        ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        : "bg-background/15 hover:bg-background/25 text-background"
                    )}
                    onClick={() => action.onClick(selectedRows)}
                  >
                    {action.icon && (
                      <span className="[&_svg]:h-4 [&_svg]:w-4">
                        {action.icon}
                      </span>
                    )}
                    {action.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-background/15 transition-colors text-background/70 hover:text-background"
                onClick={() => table.toggleAllRowsSelected(false)}
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">Bỏ chọn</span>
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
