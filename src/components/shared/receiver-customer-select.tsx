"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { getCustomers } from "@/lib/services/supabase";
import type { Customer } from "@/lib/types";

export function ReceiverCustomerSelect({
  onSelect,
  compact = false,
}: {
  onSelect: (customer: Customer) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getCustomers({
        page: 0,
        pageSize: 8,
        search: query.trim(),
        filters: {},
        sortBy: "name",
        sortOrder: "asc",
      })
        .then((result) => {
          if (!cancelled) setResults(result.data);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Chọn khách đã lưu..."
        className={compact ? "h-7 text-[11px]" : undefined}
        data-allow-hotkeys="true"
      />
      {open && query.trim() && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Không tìm thấy</div>
          ) : (
            results.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(customer);
                  setQuery(customer.name);
                  setOpen(false);
                }}
              >
                <span className="truncate font-medium">{customer.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{customer.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
