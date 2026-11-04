"use client";

import { ReactNode } from "react";

interface ListPageLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function ListPageLayout({ sidebar, children }: ListPageLayoutProps) {
  return (
    <div data-slot="list-page-layout" className="flex min-w-0 flex-col md:h-[calc(100vh-4rem)] md:min-h-0 md:flex-row">
      {sidebar}
      <div className="flex min-w-0 flex-col max-md:pb-[env(safe-area-inset-bottom)] md:min-h-0 md:flex-1 md:overflow-hidden">
        {children}
      </div>
    </div>
  );
}
