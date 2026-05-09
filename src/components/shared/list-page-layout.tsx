"use client";

import { ReactNode } from "react";

interface ListPageLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function ListPageLayout({ sidebar, children }: ListPageLayoutProps) {
  return (
    <div className="flex h-[calc(100vh-64px)] min-h-0 flex-col md:flex-row max-md:h-[calc(100vh-64px-56px)]">
      {sidebar}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden max-md:pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}
