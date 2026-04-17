"use client";

/**
 * ProductAutocomplete — F2 modal for the POS terminal.
 *
 * Debounced search against the real products table (via `getProducts`).
 * Keyboard navigation: ↑↓ Enter/Tab Escape.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getProducts } from "@/lib/services/supabase";
import type { Product } from "@/lib/types";
import { useDebounce } from "@/lib/utils/use-debounce";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface ProductAutocompleteProps {
  open: boolean;
  onSelect: (product: Product) => void;
  onClose: () => void;
}

export function ProductAutocomplete({
  open,
  onSelect,
  onClose,
}: ProductAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const debouncedQuery = useDebounce(query, 200);

  // Re-focus on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      // Clear on close so next F2 starts fresh
      setQuery("");
      setResults([]);
      setHighlighted(0);
    }
  }, [open]);

  // Fetch on debounced query
  useEffect(() => {
    if (!open) return;
    if (!debouncedQuery || debouncedQuery.trim().length === 0) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getProducts({
      page: 0,
      pageSize: 10,
      search: debouncedQuery.trim(),
      filters: { status: "active" },
      sortBy: "name",
      sortOrder: "asc",
    })
      .then((res) => {
        if (cancelled) return;
        setResults(res.data);
        setHighlighted(0);
      })
      .catch(() => {
        if (cancelled) return;
        setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(
      `li[data-idx="${highlighted}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const commitSelection = useCallback(
    (idx: number) => {
      const chosen = results[idx];
      if (!chosen) return;
      onSelect(chosen);
      setQuery("");
      // keep open for rapid-fire scanning
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [results, onSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (results.length > 0) commitSelection(highlighted);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [results, highlighted, commitSelection, onClose]
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-x-0 top-16 mx-auto z-50 max-w-2xl px-4">
        <div className="rounded-lg bg-white border border-slate-200 shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200">
            <Icon name="search" size={16} className="text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              data-allow-hotkeys="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Quét mã hoặc nhập tên sản phẩm..."
              className="flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
            />
            {loading && <Icon name="progress_activity" size={16} className="animate-spin text-slate-400" />}
            <kbd className="font-mono text-[10px] bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-500">
              Esc
            </kbd>
          </div>

          {/* Results */}
          <ul ref={listRef} className="max-h-96 overflow-y-auto">
            {results.length === 0 && debouncedQuery && !loading && (
              <li className="px-4 py-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
                <Icon name="pageview" size={24} className="text-slate-300" />
                Không tìm thấy sản phẩm nào
              </li>
            )}
            {results.length === 0 && !debouncedQuery && (
              <li className="px-4 py-6 text-center text-xs text-slate-400">
                Nhập tên / mã sản phẩm để tìm kiếm
              </li>
            )}
            {results.map((p, i) => (
              <li
                key={p.id}
                data-idx={i}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => commitSelection(i)}
                className={cn(
                  "px-4 py-2.5 cursor-pointer border-b border-slate-100 last:border-0 flex items-center justify-between gap-4",
                  i === highlighted && "bg-blue-50"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-slate-500">
                    {p.code}
                  </div>
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {p.name}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {formatCurrency(p.sellPrice)} ₫
                  </div>
                  <div
                    className={cn(
                      "text-[11px]",
                      p.stock <= 0
                        ? "text-red-600 font-medium"
                        : p.stock <= 5
                          ? "text-amber-600"
                          : "text-slate-500"
                    )}
                  >
                    Tồn: {p.stock} {p.sellUnit ?? p.unit ?? ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Footer hint */}
          <div className="flex items-center justify-between px-4 h-9 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
            <div className="flex items-center gap-2.5">
              <span>
                <kbd className="font-mono bg-white border border-slate-200 rounded px-1 text-[10px]">
                  ↑ ↓
                </kbd>{" "}
                chọn
              </span>
              <span>
                <kbd className="font-mono bg-white border border-slate-200 rounded px-1 text-[10px]">
                  Enter
                </kbd>{" "}
                thêm
              </span>
              <span>
                <kbd className="font-mono bg-white border border-slate-200 rounded px-1 text-[10px]">
                  Esc
                </kbd>{" "}
                đóng
              </span>
            </div>
            {results.length > 0 && <span>{results.length} kết quả</span>}
          </div>
        </div>
      </div>
    </>
  );
}
