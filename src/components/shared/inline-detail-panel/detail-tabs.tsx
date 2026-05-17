"use client";

import { ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export interface DetailTab {
  id: string;
  label: string;
  content: ReactNode;
  icon?: ReactNode;
}

interface DetailTabsProps {
  tabs: DetailTab[];
  defaultTab?: string;
  className?: string;
}

export function DetailTabs({ tabs, defaultTab, className }: DetailTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || "");

  const activeContent = tabs.find((t) => t.id === activeTab)?.content;

  return (
    <div className={cn("flex flex-col min-w-0", className)}>
      {/* Tab headers — Day 17/05/2026: overflow-x-auto cho laptop nhỏ
          9+ tabs × 70px = >600px, vượt panel ~500px → user kéo ngang */}
      <div className="border-b overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-0 min-w-max">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                "border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
              )}
            >
              {tab.icon && <span className="mr-1 inline-flex">{tab.icon}</span>}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — wrap với overflow-x-auto cho table bên trong tràn */}
      <div className="p-4 overflow-x-auto">{activeContent}</div>
    </div>
  );
}
