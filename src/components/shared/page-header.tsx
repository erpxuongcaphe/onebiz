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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface PageAction {
  label: string;
  icon?: ReactNode;
  variant?: "default" | "outline" | "ghost";
  onClick?: () => void;
  href?: string;
}

interface ExportHandlers {
  excel?: () => void;
  csv?: () => void;
  pdf?: () => void;
}

interface PageHeaderProps {
  title: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  actions?: PageAction[];
  onExport?: ExportHandlers;
  onImport?: (file: File) => void;
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
      // Reset so the same file can be selected again
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
        Nhập file
      </Button>
    </>
  );
}

export function PageHeader({
  title,
  searchPlaceholder = "Tìm kiếm...",
  searchValue,
  onSearchChange,
  actions = [],
  onExport,
  onImport,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("border-b bg-white", className)}>
      {/* Mobile: stack vertically */}
      <div className="p-4 space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{title}</h1>
          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2">
            {onImport && <ImportButton onImport={onImport} />}
            {onExport && <ExportButton onExport={onExport} />}
            {actions.map((action, i) => (
              <ActionButton key={i} action={action} />
            ))}
          </div>
        </div>

        {/* Search bar */}
        {onSearchChange !== undefined && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9 h-9"
              />
            </div>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Mobile actions */}
        {(actions.length > 0 || onExport || onImport) && (
          <div className="flex items-center gap-2 md:hidden overflow-x-auto">
            {onImport && <ImportButton onImport={onImport} />}
            {onExport && <ExportButton onExport={onExport} />}
            {actions.map((action, i) => (
              <ActionButton key={i} action={action} />
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
