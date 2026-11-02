"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { getReceiverContacts, type ReceiverContact } from "@/lib/services/supabase/receiver-contacts";

export function ReceiverCustomerSelect({
  onSelect,
  compact = false,
}: {
  onSelect: (customer: ReceiverContact) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<{ query: string; rows: ReceiverContact[]; failed: boolean }>({ query: "", rows: [], failed: false });
  const [open, setOpen] = useState(false);
  const results = lookup.query === query.trim() ? lookup.rows : [];

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getReceiverContacts(query.trim(), controller.signal)
        .then((result) => {
          if (!cancelled) setLookup({ query: query.trim(), rows: result, failed: false });
        })
        .catch(() => {
          if (!cancelled) setLookup({ query: query.trim(), rows: [], failed: true });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
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
        className={compact ? "h-7 text-xs" : undefined}
        data-allow-hotkeys="true"
      />
      {open && query.trim() && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
          {lookup.query !== query.trim() ? (
            <div role="status" className="px-3 py-2 text-xs text-muted-foreground">Đang tìm...</div>
          ) : lookup.failed ? (
            <div role="alert" className="px-3 py-2 text-xs text-destructive">Không tải được người nhận. Vui lòng thử lại.</div>
          ) : results.length === 0 ? (
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
