"use client";

import { ReactNode, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface PageAction {
  label: string;
  icon?: ReactNode;
  variant?: "default" | "outline" | "ghost";
  onClick?: () => void;
  href?: string;
  /** If true, rendered in the 3-dot overflow menu */
  overflow?: boolean;
  /** Disable the button (useful for loading states) */
  disabled?: boolean;
}

interface ExportHandlers {
  excel?: () => void;
  csv?: () => void;
  pdf?: () => void;
}

interface PageHeaderProps {
  title: string;
  /** Optional tabs rendered next to the title (e.g. NVL/SKU) */
  tabs?: ReactNode;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  actions?: PageAction[];
  onExport?: ExportHandlers;
  onImport?: (file: File) => void;
  /** Show column toggle icon button */
  showColumnToggle?: boolean;
  onColumnToggle?: () => void;
  /** Show settings gear icon */
  showSettings?: boolean;
  onSettings?: () => void;
  /** Show help icon */
  showHelp?: boolean;
  onHelp?: () => void;
  children?: ReactNode;
  className?: string;
}

function ActionButton({ action }: { action: PageAction }) {
  const handleClick = () => {
    if (action.onClick) {
      action.onClick();
    } else if (action.href) {
      window.location.href = action.href;
    }
  };

  return (
    <Button
      variant={action.variant || "outline"}
      size="sm"
      onClick={handleClick}
      disabled={action.disabled}
      className="gap-1.5 shrink-0"
    >
      {action.icon}
      {action.label}
    </Button>
  );
}

function ExportButton({ onExport }: { onExport: ExportHandlers }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center justify-center gap-1.5 shrink-0",
          "rounded-md text-sm font-medium",
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
          "h-8 px-3 cursor-pointer"
        )}
      >
        <Icon name="download" size={16} />
        Xuất file
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onExport.excel && (
          <DropdownMenuItem onClick={onExport.excel}>
            <Icon name="table_view" size={16} />
            Xuất Excel (.xlsx)
          </DropdownMenuItem>
        )}
        {onExport.csv && (
          <DropdownMenuItem onClick={onExport.csv}>
            <Icon name="description" size={16} />
            Xuất CSV
          </DropdownMenuItem>
        )}
        {onExport.pdf && (
          <DropdownMenuItem onClick={onExport.pdf}>
            <Icon name="picture_as_pdf" size={16} />
            Xuất PDF
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ImportButton({ onImport }: { onImport: (file: File) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImport(file);
      e.target.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
        accept=".xlsx,.xls,.csv"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className="gap-1.5 shrink-0"
      >
        <Icon name="upload" size={16} />
        Import file
      </Button>
    </>
  );
}

function IconButton({
  icon,
  tooltip,
  onClick,
}: {
  icon: ReactNode;
  tooltip: string;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClick}
      title={tooltip}
    >
      {icon}
    </Button>
  );
}

export function PageHeader({
  title,
  tabs,
  searchPlaceholder = "Tìm kiếm...",
  searchValue,
  onSearchChange,
  actions = [],
  onExport,
  onImport,
  showColumnToggle,
  onColumnToggle,
  showSettings,
  onSettings,
  showHelp,
  onHelp,
  children,
  className,
}: PageHeaderProps) {
  const mainActions = actions.filter((a) => !a.overflow);
  const overflowActions = actions.filter((a) => a.overflow);

  return (
    // Stitch style: bg-surface-container-lowest + ambient-shadow thay border-b;
    // title font-medium nhẹ nhàng hơn font-semibold.
    <div className={cn("bg-surface-container-lowest border-b", className)}>
      <div className="p-4 space-y-3">
        {/* Title row: Title (left) + Search (center) + Actions (right) */}
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-medium shrink-0 text-on-surface">{title}</h1>

          {tabs && <div className="shrink-0">{tabs}</div>}

          {/* Search bar — centered.
              Trước đây có nút "tune" (≂) ở phải nhưng là dead button (không
              có onClick handler) → CEO chốt bỏ. Search hiện match mã + tên,
              đủ cho ~95% case. Cần thêm trường (mã vạch, ...) thì mở rộng
              service `.or(...)` thay vì thêm popover chọn trường (giảm
              cognitive load cho nhân viên chưa training). */}
          {onSearchChange !== undefined && (
            <div className="relative flex-1 max-w-md">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9 h-9"
              />
            </div>
          )}

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-1.5 ml-auto">
            {mainActions.map((action, i) => (
              <ActionButton key={i} action={action} />
            ))}
            {onImport && <ImportButton onImport={onImport} />}
            {onExport && <ExportButton onExport={onExport} />}

            {/* Overflow menu (3-dot) */}
            {overflowActions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex items-center justify-center rounded-md",
                    "border border-input bg-background hover:bg-accent",
                    "h-8 w-8 shrink-0 cursor-pointer"
                  )}
                >
                  <Icon name="more_horiz" size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {overflowActions.map((action, i) => (
                    <DropdownMenuItem key={i} onClick={action.onClick}>
                      {action.icon && (
                        <span className="mr-1.5">{action.icon}</span>
                      )}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Icon buttons — KiotViet style */}
            {showColumnToggle && (
              <IconButton
                icon={<Icon name="list" size={16} />}
                tooltip="Hiển thị cột"
                onClick={onColumnToggle}
              />
            )}
            {showSettings && (
              <IconButton
                icon={<Icon name="settings" size={16} />}
                tooltip="Cài đặt"
                onClick={onSettings}
              />
            )}
            {showHelp && (
              <IconButton
                icon={<Icon name="help" size={16} />}
                tooltip="Trợ giúp"
                onClick={onHelp}
              />
            )}
          </div>
        </div>

        {/* Mobile actions */}
        {(mainActions.length > 0 || onExport || onImport) && (
          <div className="flex items-center gap-2 md:hidden overflow-x-auto">
            {mainActions.map((action, i) => (
              <ActionButton key={i} action={action} />
            ))}
            {onImport && <ImportButton onImport={onImport} />}
            {onExport && <ExportButton onExport={onExport} />}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
