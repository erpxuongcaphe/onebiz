"use client";

/**
 * FnbSearchModal — F3 product search for FnB POS.
 *
 * In-memory filtering on the already-loaded product array.
 * Keyboard-navigable (↑↓ Enter Esc).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useDebounce } from "@/lib/utils/use-debounce";
import type { FnbProduct } from "./fnb-product-grid";
import { Icon } from "@/components/ui/icon";

interface FnbSearchModalProps {
  open: boolean;
  products: FnbProduct[];
  onSelect: (product: FnbProduct) => void;
  onClose: () => void;
}

export function FnbSearchModal({
  open,
  products,
  onSelect,
  onClose,
}: FnbSearchModalProps) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const debouncedQuery = useDebounce(query, 150);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setHighlighted(0);
    }
  }, [open]);

  const filtered = (() => {
    if (!debouncedQuery.trim()) return products.slice(0, 20);
    const q = debouncedQuery.toLowerCase().trim();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q)
      )
      .slice(0, 20);
  })();

  useEffect(() => {
    setHighlighted(0);
  }, [debouncedQuery]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(
      `li[data-idx="${highlighted}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const commitSelection = useCallback(
    (idx: number) => {
      const product = filtered[idx];
      if (!product) return;
      onSelect(product);
    },
    [filtered, onSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        commitSelection(highlighted);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered.length, highlighted, commitSelection, onClose]
  );

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div className="fixed inset-x-0 top-14 mx-auto z-50 max-w-2xl px-4">
        <div className="rounded-lg bg-white border border-border shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 h-12 border-b border-border">
            <Icon name="search" size={16} className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              data-allow-hotkeys="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tìm món theo tên hoặc mã..."
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <kbd className="font-mono text-[10px] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground">
              Esc
            </kbd>
          </div>

          {/* Results */}
          <ul ref={listRef} className="max-h-80 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                Không tìm thấy sản phẩm
              </li>
            ) : (
              filtered.map((product, idx) => (
                <li
                  key={product.id}
                  data-idx={idx}
                  onMouseEnter={() => setHighlighted(idx)}
                  onClick={() => commitSelection(idx)}
                  className={cn(
                    "px-4 py-2 cursor-pointer border-b border-border/40 last:border-0 flex items-center gap-3",
                    highlighted === idx && "bg-primary-fixed"
                  )}
                >
                  <span className="text-[11px] text-muted-foreground font-mono w-20 shrink-0 truncate">
                    {product.code}
                  </span>
                  <span className="flex-1 text-sm text-foreground truncate">
                    {product.name}
                  </span>
                  <span className="text-sm font-semibold text-primary tabular-nums shrink-0">
                    {formatCurrency(product.sell_price)}
                  </span>
                </li>
              ))
            )}
          </ul>

          {/* Footer hints */}
          <div className="flex items-center justify-between px-4 h-9 bg-muted/50 border-t border-border text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2.5">
              <span>
                <kbd className="font-mono bg-white border border-border rounded px-1 text-[10px]">
                  ↑ ↓
                </kbd>{" "}
                chọn
              </span>
              <span>
                <kbd className="font-mono bg-white border border-border rounded px-1 text-[10px]">
                  Enter
                </kbd>{" "}
                thêm
              </span>
              <span>
                <kbd className="font-mono bg-white border border-border rounded px-1 text-[10px]">
                  Esc
                </kbd>{" "}
                đóng
              </span>
            </div>
            <span>{filtered.length} kết quả</span>
          </div>
        </div>
      </div>
    </>
  );
}
