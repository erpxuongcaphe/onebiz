"use client";

// ---------------------------------------------------------------------------
// Command Palette — Cmd+K global search
// - Provider + hook, chỉ cần bọc ở layout
// - Phím tắt: Cmd/Ctrl+K để mở, Esc để đóng, ↑↓ điều hướng, Enter chọn
// - Nguồn dữ liệu: nav routes + products + customers + suppliers + quick actions
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { mainNavItems } from "./nav-config";
import { getProducts, getCustomers, getSuppliers } from "@/lib/services";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommandKind = "navigation" | "action" | "product" | "customer" | "supplier";

export interface CommandItem {
  id: string;
  kind: CommandKind;
  label: string;
  description?: string;
  keywords?: string;
  icon: ReactNode;
  onSelect: () => void;
}

interface CommandPaletteContextValue {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => setOpen((prev) => !prev), []);

  // Global hotkey Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ open, openPalette, closePalette, togglePalette }),
    [open, openPalette, closePalette, togglePalette]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPaletteDialog open={open} onOpenChange={setOpen} />
    </CommandPaletteContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface GroupedItems {
  label: string;
  items: CommandItem[];
}

function CommandPaletteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [remoteItems, setRemoteItems] = useState<CommandItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      onOpenChange(false);
    },
    [router, onOpenChange]
  );

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIdx(0);
      setRemoteItems([]);
    } else {
      // Autofocus
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Local static items (navigation + quick actions)
  const staticItems = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = [];
    for (const group of mainNavItems) {
      if (group.href) {
        nav.push({
          id: `nav:${group.href}`,
          kind: "navigation",
          label: group.label,
          description: group.href,
          keywords: group.label,
          icon: <Icon name="arrow_forward" size={16} className="text-muted-foreground" />,
          onSelect: () => go(group.href!),
        });
      }
      if (group.items) {
        for (const sub of group.items) {
          for (const item of sub.items) {
            nav.push({
              id: `nav:${item.href}`,
              kind: "navigation",
              label: item.label,
              description: `${group.label}${sub.groupLabel ? ` · ${sub.groupLabel}` : ""}`,
              keywords: `${group.label} ${sub.groupLabel ?? ""} ${item.label}`,
              icon: <Icon name="arrow_forward" size={16} className="text-muted-foreground" />,
              onSelect: () => go(item.href),
            });
          }
        }
      }
    }

    const actions: CommandItem[] = [
      {
        id: "action:new-product",
        kind: "action",
        label: "Tạo sản phẩm mới",
        description: "Hàng hóa",
        keywords: "tao san pham moi product new hang hoa",
        icon: <Icon name="add" size={16} className="text-primary" />,
        onSelect: () => go("/hang-hoa?new=1"),
      },
      {
        id: "action:new-bom",
        kind: "action",
        label: "Tạo công thức (BOM)",
        description: "Sản xuất",
        keywords: "bom cong thuc san xuat formula",
        icon: <Icon name="add" size={16} className="text-primary" />,
        onSelect: () => go("/hang-hoa/cong-thuc"),
      },
      {
        id: "action:new-production",
        kind: "action",
        label: "Tạo lệnh sản xuất",
        description: "Sản xuất",
        keywords: "lenh san xuat production order",
        icon: <Icon name="add" size={16} className="text-primary" />,
        onSelect: () => go("/hang-hoa/san-xuat"),
      },
      {
        id: "action:new-invoice",
        kind: "action",
        label: "Tạo hóa đơn",
        description: "Đơn hàng",
        keywords: "hoa don invoice",
        icon: <Icon name="add" size={16} className="text-primary" />,
        onSelect: () => go("/don-hang/hoa-don"),
      },
    ];

    return [...nav, ...actions];
  }, [go]);

  // Debounced remote search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRemoteItems([]);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const [products, customers, suppliers] = await Promise.all([
          getProducts({ page: 0, pageSize: 5, search: q, filters: {} }).catch(() => ({
            data: [],
            total: 0,
          })),
          getCustomers({ page: 0, pageSize: 5, search: q, filters: {} }).catch(() => ({
            data: [],
            total: 0,
          })),
          getSuppliers({ page: 0, pageSize: 5, search: q, filters: {} }).catch(() => ({
            data: [],
            total: 0,
          })),
        ]);
        if (cancelled) return;

        const items: CommandItem[] = [];
        for (const p of products.data) {
          items.push({
            id: `product:${p.id}`,
            kind: "product",
            label: p.name,
            description: `${p.code} · ${p.categoryName ?? "Không nhóm"}`,
            icon: <Icon name="inventory_2" size={16} className="text-primary" />,
            onSelect: () => go(`/hang-hoa?focus=${p.id}`),
          });
        }
        for (const c of customers.data) {
          items.push({
            id: `customer:${c.id}`,
            kind: "customer",
            label: c.name,
            description: c.phone ?? c.email ?? "Khách hàng",
            icon: <Icon name="person" size={16} className="text-emerald-600" />,
            onSelect: () => go(`/khach-hang?focus=${c.id}`),
          });
        }
        for (const s of suppliers.data) {
          items.push({
            id: `supplier:${s.id}`,
            kind: "supplier",
            label: s.name,
            description: s.phone ?? s.email ?? "Nhà cung cấp",
            icon: <Icon name="local_shipping" size={16} className="text-amber-600" />,
            onSelect: () => go(`/hang-hoa/nha-cung-cap?focus=${s.id}`),
          });
        }
        setRemoteItems(items);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, go]);

  // Filter static items by query
  const filteredStatic = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staticItems;
    return staticItems.filter((item) => {
      const hay = `${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, staticItems]);

  // Group items for display
  const groups = useMemo<GroupedItems[]>(() => {
    const g: GroupedItems[] = [];
    const nav = filteredStatic.filter((i) => i.kind === "navigation");
    const actions = filteredStatic.filter((i) => i.kind === "action");
    const products = remoteItems.filter((i) => i.kind === "product");
    const customers = remoteItems.filter((i) => i.kind === "customer");
    const suppliers = remoteItems.filter((i) => i.kind === "supplier");
    if (actions.length) g.push({ label: "Hành động nhanh", items: actions });
    if (products.length) g.push({ label: "Sản phẩm", items: products });
    if (customers.length) g.push({ label: "Khách hàng", items: customers });
    if (suppliers.length) g.push({ label: "Nhà cung cấp", items: suppliers });
    if (nav.length) g.push({ label: "Điều hướng", items: nav });
    return g;
  }, [filteredStatic, remoteItems]);

  // Flat list for keyboard nav
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIdx(0);
  }, [query, remoteItems]);

  // Keyboard navigation
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flatItems[activeIdx]?.onSelect();
    }
  };

  // Scroll active into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-cmd-index="${activeIdx}"]`);
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 max-w-[640px] overflow-hidden"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Icon name="search" size={16} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Tìm kiếm sản phẩm, khách hàng, hành động..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          {searching && (
            <span className="text-xs text-muted-foreground">Đang tìm...</span>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[400px] overflow-y-auto py-1"
          role="listbox"
        >
          {flatItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Icon name="keyboard_command_key" className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">
                {query
                  ? "Không tìm thấy kết quả"
                  : "Gõ để tìm kiếm hoặc chọn hành động bên dưới"}
              </p>
            </div>
          ) : (
            groups.map((group) => {
              const startIdx = flatItems.indexOf(group.items[0]);
              return (
                <div key={group.label} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </div>
                  {group.items.map((item, i) => {
                    const idx = startIdx + i;
                    const isActive = idx === activeIdx;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-cmd-index={idx}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => item.onSelect()}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "bg-primary/10 text-foreground"
                            : "text-foreground hover:bg-muted/50"
                        )}
                        role="option"
                        aria-selected={isActive}
                      >
                        <span className="shrink-0">{item.icon}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate font-medium">{item.label}</span>
                          {item.description && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                        </span>
                        {isActive && (
                          <kbd className="text-[10px] font-mono text-muted-foreground">
                            ↵
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t bg-muted/20 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="font-mono bg-background border px-1 rounded">↑↓</kbd>
            điều hướng
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono bg-background border px-1 rounded">↵</kbd>
            chọn
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono bg-background border px-1 rounded">Esc</kbd>
            đóng
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Icon name="inventory_2" size={12} />
            OneBiz Command
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
