"use client";

import { ReactNode } from "react";

interface ListPageLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function ListPageLayout({ sidebar, children }: ListPageLayoutProps) {
  return (
    <div className="flex h-[calc(100vh-48px)]">
      {sidebar}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
