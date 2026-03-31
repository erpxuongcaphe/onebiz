"use client";

import { ReactNode, useState } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface FilterSidebarProps {
  children: ReactNode;
  className?: string;
}

export function FilterSidebar({ children, className }: FilterSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile filter button */}
      <Button
        variant="outline"
        size="sm"
        className="md:hidden flex items-center gap-1.5"
        onClick={() => setMobileOpen(true)}
      >
        <Filter className="h-4 w-4" />
        Bộ lọc
      </Button>

      {/* Mobile filter sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[300px] p-0">
          <SheetTitle className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold">Bộ lọc</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </SheetTitle>
          <ScrollArea className="h-[calc(100vh-57px)]">
            <div className="p-4 space-y-5">{children}</div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:block w-[240px] shrink-0 border-r bg-white overflow-y-auto",
          className
        )}
      >
        <div className="p-4 space-y-5">{children}</div>
      </aside>
    </>
  );
}

interface FilterGroupProps {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}

export function FilterGroup({
  label,
  children,
  defaultOpen = true,
  action,
}: FilterGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground mb-2"
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <div className="flex items-center gap-1">
          {action}
          <span className="text-muted-foreground text-xs">
            {open ? "−" : "+"}
          </span>
        </div>
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}
