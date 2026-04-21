"use client";
import { useAuth } from "@/lib/contexts";
import type { BranchType } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useDeviceBinding } from "@/lib/hooks/use-device-binding";

interface PosBranchSelectorProps {
  variant?: "light" | "dark";
  /**
   * Chỉ hiển thị chi nhánh có loại nằm trong danh sách này.
   * POS FnB → ["store"] (chỉ 3 quán, không hiện kho tổng / xưởng).
   * POS Retail → ["warehouse"] nếu muốn khoá vào kho tổng;
   *   hoặc omit để cho phép đổi qua store/warehouse.
   */
  filter?: BranchType[];
  /**
   * Hiện mã chi nhánh (code) phía trước tên — dễ phân biệt khi nhiều chi nhánh cùng tên.
   * Mặc định false (giữ compact cho FnB tablet).
   */
  showCode?: boolean;
}

export function PosBranchSelector({
  variant = "dark",
  filter,
  showCode = false,
}: PosBranchSelectorProps) {
  const { branches, currentBranch, switchBranch } = useAuth();
  const binding = useDeviceBinding();

  const isDark = variant === "dark";

  // Device binding: render badge tĩnh (khoá) thay vì dropdown. Staff không đổi
  // được — tránh lỡ tay switch sang quán khác giữa ca. Admin muốn đổi phải vào
  // /cai-dat/thiet-bi-pos để unbind trước.
  if (binding) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md shrink-0",
          isDark
            ? "bg-white/10 text-white ring-1 ring-white/15"
            : "text-foreground bg-surface-container border border-border",
        )}
        title={`Thiết bị khoá: ${binding.deviceName} · Chi nhánh ${currentBranch?.name ?? "—"}`}
      >
        <Icon name="lock" size={14} className="shrink-0 opacity-80" />
        <span className="truncate max-w-[240px] font-semibold tracking-tight">
          {currentBranch
            ? showCode && currentBranch.code
              ? `${currentBranch.code} · ${currentBranch.name}`
              : currentBranch.name
            : binding.deviceName}
        </span>
      </div>
    );
  }

  // Filter theo type nếu prop có. Nếu hiện tại user đang ở branch không thuộc
  // filter (vd admin gán staff vào office rồi staff mở POS FnB), vẫn giữ branch
  // đó trong list để không làm user stuck — admin cần đổi ở side panel khác.
  const filtered = filter
    ? branches.filter(
        (b) => filter.includes(b.branchType) || b.id === currentBranch?.id,
      )
    : branches;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md transition-colors cursor-pointer outline-none shrink-0",
          isDark
            ? "bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20"
            : "text-foreground hover:text-on-surface hover:bg-surface-container border border-border",
        )}
        title={
          currentBranch
            ? `Chi nhánh đang ghi nhận đơn: ${currentBranch.name}`
            : "Chưa chọn chi nhánh"
        }
      >
        <Icon name="apartment" size={16} className="shrink-0" />
        <span className="truncate max-w-[240px] font-semibold tracking-tight">
          {currentBranch
            ? showCode && currentBranch.code
              ? `${currentBranch.code} · ${currentBranch.name}`
              : currentBranch.name
            : "Chọn chi nhánh"}
        </span>
        <Icon name="expand_more" size={14} className="shrink-0 opacity-80" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[220px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            Chọn chi nhánh
            {filter && filter.length > 0 && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({filtered.length})
              </span>
            )}
          </DropdownMenuLabel>
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">
              Không có chi nhánh phù hợp
            </div>
          )}
          {filtered.map((branch) => (
            <DropdownMenuItem
              key={branch.id}
              className="cursor-pointer"
              onSelect={() => switchBranch(branch.id)}
            >
              <span className="flex-1 flex items-center gap-2">
                {branch.code && (
                  <span className="text-xs font-mono text-muted-foreground">
                    {branch.code}
                  </span>
                )}
                <span>{branch.name}</span>
              </span>
              {currentBranch?.id === branch.id && (
                <Icon name="check" size={16} className="text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
