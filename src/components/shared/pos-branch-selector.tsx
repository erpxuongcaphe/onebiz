"use client";

/**
 * PosBranchSelector — Inline branch picker for POS pages.
 * POS requires a specific branch (no "Tất cả chi nhánh" option).
 * Supports dark (FnB header) and light (retail/admin) variants.
 */

import { Building2, ChevronDown, Check } from "lucide-react";
import { useAuth } from "@/lib/contexts";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface PosBranchSelectorProps {
  variant?: "light" | "dark";
}

export function PosBranchSelector({ variant = "dark" }: PosBranchSelectorProps) {
  const { branches, currentBranch, switchBranch } = useAuth();

  const isDark = variant === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md transition-colors cursor-pointer outline-none shrink-0",
          isDark
            ? "text-slate-300 hover:text-white hover:bg-slate-800"
            : "text-gray-700 hover:text-gray-900 hover:bg-gray-100 border border-gray-200"
        )}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[140px] font-medium">
          {currentBranch?.name ?? "Chọn chi nhánh"}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[200px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Chọn chi nhánh</DropdownMenuLabel>
          {branches.map((branch) => (
            <DropdownMenuItem
              key={branch.id}
              className="cursor-pointer"
              onSelect={() => switchBranch(branch.id)}
            >
              <span className="flex-1">{branch.name}</span>
              {currentBranch?.id === branch.id && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
