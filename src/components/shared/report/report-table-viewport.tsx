"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ReportTableViewport({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const scrollbar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const content = viewport.current;
    const bar = scrollbar.current;
    if (!content || !bar) return;
    const measure = () => setWidth(content.scrollWidth > content.clientWidth + 1 ? content.scrollWidth : 0);
    const fromContent = () => { if (bar.scrollLeft !== content.scrollLeft) bar.scrollLeft = content.scrollLeft; };
    const fromBar = () => { if (content.scrollLeft !== bar.scrollLeft) content.scrollLeft = bar.scrollLeft; };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(content);
    const table = content.querySelector("table") ?? content.firstElementChild;
    if (table) observer?.observe(table);
    const mutations = new MutationObserver(() => {
      const currentTable = content.querySelector("table");
      if (currentTable) observer?.observe(currentTable);
      measure();
    });
    mutations.observe(content, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    content.addEventListener("scroll", fromContent, { passive: true });
    bar.addEventListener("scroll", fromBar, { passive: true });
    measure();
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", measure);
      content.removeEventListener("scroll", fromContent);
      bar.removeEventListener("scroll", fromBar);
    };
  }, []);

  return (
    <div className="relative min-w-0">
      <div ref={viewport} data-report-viewport role="region" aria-label="Bảng số liệu báo cáo" tabIndex={0}
        className="max-h-[65dvh] min-w-0 overflow-auto overscroll-x-contain bg-surface-container-lowest outline-none focus-visible:ring-2 focus-visible:ring-ring print:max-h-none print:overflow-visible">
        {children}
      </div>
      <div ref={scrollbar} role="region" aria-label="Cuộn ngang bảng báo cáo" tabIndex={width ? 0 : -1}
        className="sticky bottom-0 z-30 overflow-x-auto overflow-y-hidden border-t border-border bg-surface-container-lowest [scrollbar-width:auto] [&::-webkit-scrollbar]:h-3 focus-visible:ring-2 focus-visible:ring-ring print:hidden"
        style={{ height: width ? 18 : 0, visibility: width ? "visible" : "hidden" }}>
        <div style={{ width, height: 1 }} />
      </div>
    </div>
  );
}
