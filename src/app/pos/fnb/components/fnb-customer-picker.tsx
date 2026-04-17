"use client";

/**
 * FnbCustomerPicker — F4 customer lookup for FnB POS.
 *
 * Adapted from the retail POS CustomerPicker.
 * Debounced API search against customer database.
 * "Khách lẻ" always appears first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getCustomers } from "@/lib/services/supabase";
import type { Customer } from "@/lib/types";
import { useDebounce } from "@/lib/utils/use-debounce";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface FnbCustomerPickerProps {
  open: boolean;
  onSelect: (customer: Customer | null) => void; // null = Khách lẻ
  onClose: () => void;
}

export function FnbCustomerPicker({
  open,
  onSelect,
  onClose,
}: FnbCustomerPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setResults([]);
      setHighlighted(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getCustomers({
      page: 0,
      pageSize: 10,
      search: debouncedQuery.trim() || "",
      filters: {},
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

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(
      `li[data-idx="${highlighted}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const totalOptions = 1 + results.length;

  const commitSelection = useCallback(
    (idx: number) => {
      if (idx === 0) {
        onSelect(null); // Khách lẻ
      } else {
        const cust = results[idx - 1];
        if (!cust) return;
        onSelect(cust);
      }
      onClose();
    },
    [results, onSelect, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, totalOptions - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        commitSelection(highlighted);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [totalOptions, highlighted, commitSelection, onClose]
  );

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div className="fixed inset-x-0 top-14 mx-auto z-50 max-w-2xl px-4">
        <div className="rounded-lg bg-white border border-slate-200 shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200">
            <Icon name="search" size={16} className="text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              data-allow-hotkeys="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tìm tên / SĐT / mã khách hàng..."
              className="flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
            />
            {loading && (
              <Icon name="progress_activity" size={16} className="animate-spin text-slate-400" />
            )}
            <kbd className="font-mono text-[10px] bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-500">
              Esc
            </kbd>
          </div>

          <ul ref={listRef} className="max-h-96 overflow-y-auto">
            {/* Walk-in guest option */}
            <li
              data-idx={0}
              onMouseEnter={() => setHighlighted(0)}
              onClick={() => commitSelection(0)}
              className={cn(
                "px-4 py-2.5 cursor-pointer border-b border-slate-100 flex items-center gap-3",
                highlighted === 0 && "bg-primary-fixed"
              )}
            >
              <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <Icon name="person_add" size={16} className="text-slate-500" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">
                  Khách lẻ
                </div>
                <div className="text-[11px] text-slate-500">
                  Không gán khách hàng
                </div>
              </div>
            </li>

            {results.map((c, i) => {
              const idx = i + 1;
              return (
                <li
                  key={c.id}
                  data-idx={idx}
                  onMouseEnter={() => setHighlighted(idx)}
                  onClick={() => commitSelection(idx)}
                  className={cn(
                    "px-4 py-2.5 cursor-pointer border-b border-slate-100 last:border-0 flex items-center gap-3",
                    highlighted === idx && "bg-primary-fixed"
                  )}
                >
                  <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <Icon name="person" size={16} className="text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {c.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {c.phone || c.code || "—"}
                    </div>
                  </div>
                  {c.currentDebt > 0 && (
                    <div className="text-[11px] text-red-600 font-medium shrink-0">
                      Nợ {new Intl.NumberFormat("vi-VN").format(c.currentDebt)} ₫
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

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
                chọn KH
              </span>
              <span>
                <kbd className="font-mono bg-white border border-slate-200 rounded px-1 text-[10px]">
                  Esc
                </kbd>{" "}
                đóng
              </span>
            </div>
            <span>{totalOptions} tuỳ chọn</span>
          </div>
        </div>
      </div>
    </>
  );
}
