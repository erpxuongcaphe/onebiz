"use client";

/**
 * FnbCustomerPicker — F4 customer lookup for FnB POS.
 *
 * Adapted from the retail POS CustomerPicker.
 * Debounced API search against customer database.
 * "Khách lẻ" always appears first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getFnbCustomerContacts, type PosCustomerIdentity } from "@/lib/services/supabase/pos-customer-contacts";
import { useDebounce } from "@/lib/utils/use-debounce";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface FnbCustomerPickerProps {
  open: boolean;
  branchId: string;
  onSelect: (customer: PosCustomerIdentity | null) => void; // null = Khách lẻ
  onClose: () => void;
}

const EMPTY_CONTACTS: PosCustomerIdentity[] = [];

export function FnbCustomerPicker({
  open,
  branchId,
  onSelect,
  onClose,
}: FnbCustomerPickerProps) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{ key: string; rows: PosCustomerIdentity[]; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const debouncedQuery = useDebounce(query, 200);
  const requestKey = `${branchId}:${debouncedQuery.trim()}:${retry}`;
  const currentResponse = response?.key === requestKey && query.trim() === debouncedQuery.trim() ? response : null;
  const results = currentResponse?.rows ?? EMPTY_CONTACTS;

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    getFnbCustomerContacts({ branchId, search: debouncedQuery, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        setResponse({ key: requestKey, rows: res, failed: false });
        setHighlighted(0);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResponse({ key: requestKey, rows: [], failed: true });
      });
    return () => {
      controller.abort();
    };
  }, [branchId, debouncedQuery, requestKey, open, retry]);

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
        <div className="rounded-lg bg-popover text-popover-foreground border border-border ambient-shadow-floating overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-border">
            <Icon name="search" size={16} className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              data-allow-hotkeys="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tìm tên / SĐT / mã khách hàng..."
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            {!currentResponse && (
              <Icon name="progress_activity" size={16} className="animate-spin text-muted-foreground" />
            )}
            <kbd className="font-mono text-xs bg-muted border border-border rounded px-2 py-0.5 text-muted-foreground">
              Esc
            </kbd>
          </div>

          {/* 06/08: 384px cứng → theo dvh, bàn phím ảo mở vẫn chạm được đáy danh sách. */}
          <ul ref={listRef} className="max-h-[calc(100dvh-14rem)] sm:max-h-96 overflow-y-auto">
            {/* Walk-in guest option */}
            <li
              data-idx={0}
              onMouseEnter={() => setHighlighted(0)}
              onClick={() => commitSelection(0)}
              className={cn(
                "px-4 py-3 cursor-pointer border-b border-border/40 flex items-center gap-3",
                highlighted === 0 && "bg-primary-fixed"
              )}
            >
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Icon name="person_add" size={16} className="text-muted-foreground" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">
                  Khách lẻ
                </div>
                <div className="text-xs text-muted-foreground">
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
                    "px-4 py-3 cursor-pointer border-b border-border/40 last:border-0 flex items-center gap-3",
                    highlighted === idx && "bg-primary-fixed"
                  )}
                >
                  <div className="h-8 w-8 rounded-full bg-status-success/10 flex items-center justify-center shrink-0">
                    <Icon name="person" size={16} className="text-status-success" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {c.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.phone || c.code || "—"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {currentResponse?.failed && (
            <div role="alert" className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-status-error">
              <span>Chưa tải được khách.</span>
              <button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-10 px-2 font-medium">Thử lại</button>
            </div>
          )}
          {currentResponse && !currentResponse.failed && results.length === 0 && (
            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">Không tìm thấy khách.</p>
          )}

          <div className="hidden sm:flex items-center justify-between px-4 h-8 bg-muted/50 border-t border-border text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="font-mono bg-card border border-border rounded px-1 text-xs">
                  ↑ ↓
                </kbd>{" "}
                chọn
              </span>
              <span>
                <kbd className="font-mono bg-card border border-border rounded px-1 text-xs">
                  Enter
                </kbd>{" "}
                chọn KH
              </span>
              <span>
                <kbd className="font-mono bg-card border border-border rounded px-1 text-xs">
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
