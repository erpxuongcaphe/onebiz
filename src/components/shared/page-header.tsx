"use client";

import { ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionButton {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  variant?: "default" | "outline" | "ghost";
}

interface PageHeaderProps {
  title: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  actions?: ActionButton[];
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  searchPlaceholder = "Tìm kiếm...",
  searchValue,
  onSearchChange,
  actions = [],
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
            {actions.map((action, i) => (
              <Button
                key={i}
                variant={action.variant || "outline"}
                size="sm"
                onClick={action.onClick}
                className="gap-1.5"
              >
                {action.icon}
                {action.label}
              </Button>
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
        {actions.length > 0 && (
          <div className="flex items-center gap-2 md:hidden overflow-x-auto">
            {actions.map((action, i) => (
              <Button
                key={i}
                variant={action.variant || "outline"}
                size="sm"
                onClick={action.onClick}
                className="gap-1.5 shrink-0"
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
