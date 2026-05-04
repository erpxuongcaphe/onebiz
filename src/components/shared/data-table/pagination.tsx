"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { formatNumber } from "@/lib/format";

interface DataTablePaginationProps {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  total: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export function DataTablePagination({
  pageIndex,
  pageSize,
  pageCount,
  total,
  onPageChange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  return (
    <div className="border-t bg-surface-container-lowest px-4 py-2 flex items-center justify-between gap-4 text-sm">
      {/* KiotViet style: "Hiển thị 15 dòng" */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="hidden sm:inline">Hiển thị</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange?.(Number(v))}
        >
          <SelectTrigger className="h-7 w-[65px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[15, 20, 50, 100].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden sm:inline">dòng</span>
        <span className="text-xs text-muted-foreground/60 ml-2">
          ({formatNumber(total)} bản ghi)
        </span>
      </div>

      {/* Page navigation */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={pageIndex === 0}
          onClick={() => onPageChange?.(0)}
        >
          <Icon name="keyboard_double_arrow_left" size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={pageIndex === 0}
          onClick={() => onPageChange?.(pageIndex - 1)}
        >
          <Icon name="chevron_left" size={14} />
        </Button>
        <span className="px-2 text-xs min-w-[50px] text-center text-muted-foreground">
          {pageIndex + 1} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onPageChange?.(pageIndex + 1)}
        >
          <Icon name="chevron_right" size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onPageChange?.(pageCount - 1)}
        >
          <Icon name="keyboard_double_arrow_right" size={14} />
        </Button>
      </div>
    </div>
  );
}
