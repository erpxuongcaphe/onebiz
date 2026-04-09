"use client";

import { ReactNode, useRef } from "react";
import {
  Search,
  SlidersHorizontal,
  Download,
  Upload,
  FileSpreadsheet,
  FileText,
  FileDown,
  MoreHorizontal,
  List,
  Settings,
  HelpCircle,
} from "lucide-react";
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

interface PageAction {
  label: string;
  icon?: ReactNode;
  variant?: "default" | "outline" | "ghost";
  onClick?: () => void;
  href?: string;
  /** If true, rendered in the 3-dot overflow menu */
  overflow?: boolean;
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
        <Download className="h-4 w-4" />
        Xuất file
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onExport.excel && (
          <DropdownMenuItem onClick={onExport.excel}>
            <FileSpreadsheet className="h-4 w-4" />
            Xuất Excel (.xlsx)
          </DropdownMenuItem>
        )}
        {onExport.csv && (
          <DropdownMenuItem onClick={onExport.csv}>
            <FileText className="h-4 w-4" />
            Xuất CSV
          </DropdownMenuItem>
        )}
        {onExport.pdf && (
          <DropdownMenuItem onClick={onExport.pdf}>
            <FileDown className="h-4 w-4" />
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
        <Upload className="h-4 w-4" />
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
    <div className={cn("border-b bg-white", className)}>
      <div className="p-4 space-y-3">
        {/* Title row: Title (left) + Search (center) + Actions (right) */}
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold shrink-0">{title}</h1>

          {tabs && <div className="shrink-0">{tabs}</div>}

          {/* Search bar — centered */}
          {onSearchChange !== undefined && (
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9 h-9"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
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
                  <MoreHorizontal className="h-4 w-4" />
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
                icon={<List className="h-4 w-4" />}
                tooltip="Hiển thị cột"
                onClick={onColumnToggle}
              />
            )}
            {showSettings && (
              <IconButton
                icon={<Settings className="h-4 w-4" />}
                tooltip="Cài đặt"
                onClick={onSettings}
              />
            )}
            {showHelp && (
              <IconButton
                icon={<HelpCircle className="h-4 w-4" />}
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
