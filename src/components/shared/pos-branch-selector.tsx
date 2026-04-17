"use client";
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
import { Icon } from "@/components/ui/icon";

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
            : "text-foreground hover:text-on-surface hover:bg-surface-container border border-border"
        )}
      >
        <Icon name="apartment" size={14} className="shrink-0" />
        <span className="truncate max-w-[140px] font-medium">
          {currentBranch?.name ?? "Chọn chi nhánh"}
        </span>
        <Icon name="expand_more" size={12} className="shrink-0" />
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
                <Icon name="check" size={16} className="text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
