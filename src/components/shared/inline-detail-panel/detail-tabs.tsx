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
    <div className={cn("flex flex-col", className)}>
      {/* Tab headers */}
      <div className="flex items-center gap-0 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap",
              "border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            )}
          >
            {tab.icon && <span className="mr-1.5 inline-flex">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">{activeContent}</div>
    </div>
  );
}
