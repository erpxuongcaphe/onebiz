"use client";

/**
 * MOCKUP v4 — POS F&B optimised sau feedback CEO
 * Route: /mockup/pos-fnb-v4
 *
 * Thêm so với v3:
 *  A. Tile hiển thị ẢNH khi có (emoji proxy cho mockup) — fallback icon
 *     màu danh mục khi món chưa upload ảnh. Mô tả đúng pattern thật:
 *     SP có image_url → render ảnh, else → icon nền màu.
 *  B. Thanh TÌM MÓN sticky đầu khu thực đơn — gõ vài chữ là lọc tức thì,
 *     bỏ qua duyệt danh mục (KiotViet/Toast pattern).
 *  C. Thanh BÁN CHẠY NHANH (Quick Order) — 6 món bán chạy luôn hiện dưới
 *     search bar, 1 chạm tới top sellers dù đang ở danh mục nào (Toast).
 *
 * Mockup — không đụng data thật.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

interface SizeOpt { id: string; label: string; priceDelta: number }
interface ToppingOpt { id: string; name: string; price: number }
interface ProductV4 {
  id: string; name: string; price: number; catId: string; fav?: boolean;
  /** Mockup: emoji proxy cho ảnh thật. Sản xuất sẽ là URL ảnh. */
  image?: string;
  sizes?: SizeOpt[]; sugar?: boolean; ice?: boolean; toppings?: ToppingOpt[];
}

const SWEETNESS = ["Không đường", "30%", "50%", "70%", "100%"] as const;
const ICE = ["Không đá", "Ít đá", "Vừa đá", "Nhiều đá"] as const;
const NOTE_PRESETS = ["Mang đi", "Nóng", "Ít ngọt", "Riêng đá", "Không ống hút"] as const;

const CATS = [
  { id: "fav", name: "Bán chạy", icon: "star", color: "#f59e0b" },
  { id: "cafe", name: "Cà phê", icon: "local_cafe", color: "#a16207" },
  { id: "trasua", name: "Trà sữa", icon: "bubble_chart", color: "#db2777" },
  { id: "tra", name: "Trà trái cây", icon: "emoji_food_beverage", color: "#16a34a" },
  { id: "daxay", name: "Đá xay", icon: "blender", color: "#0ea5e9" },
  { id: "banh", name: "Bánh ngọt", icon: "bakery_dining", color: "#9333ea" },
  { id: "chai", name: "Đóng chai", icon: "local_drink", color: "#0891b2" },
] as const;
const CAT_BY: Record<string, (typeof CATS)[number]> = Object.fromEntries(CATS.map((c) => [c.id, c]));

const SIZE_ML: SizeOpt[] = [
  { id: "m", label: "M", priceDelta: 0 },
  { id: "l", label: "L", priceDelta: 6000 },
];
const TOPPING_DRINK: ToppingOpt[] = [
  { id: "t1", name: "Trân châu đen", price: 7000 },
  { id: "t2", name: "Trân châu trắng", price: 7000 },
  { id: "t3", name: "Thạch phô mai", price: 8000 },
  { id: "t4", name: "Pudding trứng", price: 8000 },
  { id: "t5", name: "Kem cheese", price: 10000 },
  { id: "t6", name: "Đào miếng", price: 10000 },
  { id: "t7", name: "Sương sáo", price: 7000 },
  { id: "t8", name: "Hạt é", price: 5000 },
];

// PRODUCTS: phần lớn có "image" (emoji proxy) — vài món không có để demo fallback icon
const PRODUCTS: ProductV4[] = [
  { id: "p1", name: "Cà phê sữa đá", price: 29000, catId: "cafe", fav: true, image: "☕", sizes: SIZE_ML, sugar: true, ice: true },
  { id: "p2", name: "Bạc xỉu", price: 35000, catId: "cafe", fav: true, image: "🥛", sizes: SIZE_ML, sugar: true, ice: true },
  { id: "p3", name: "Cà phê đen đá", price: 25000, catId: "cafe", image: "☕", sugar: true, ice: true },
  { id: "p4", name: "Cà phê muối", price: 39000, catId: "cafe", image: "🧂", sizes: SIZE_ML, sugar: true, ice: true },
  { id: "p5", name: "Cappuccino", price: 45000, catId: "cafe", image: "☕", sizes: SIZE_ML },
  { id: "p6", name: "Latte", price: 45000, catId: "cafe", image: "🍮", sizes: SIZE_ML },
  { id: "p7", name: "Cold Brew", price: 49000, catId: "cafe", image: "🧊" },
  { id: "p8", name: "Espresso", price: 35000, catId: "cafe" }, // không ảnh → demo fallback
  { id: "p9", name: "Trà sữa trân châu đường đen", price: 45000, catId: "trasua", fav: true, image: "🧋", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p10", name: "Trà sữa truyền thống", price: 39000, catId: "trasua", image: "🧋", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p11", name: "Trà sữa matcha", price: 45000, catId: "trasua", image: "🍵", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p12", name: "Trà sữa khoai môn", price: 42000, catId: "trasua", image: "🍠", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p13", name: "Hồng trà sữa", price: 39000, catId: "trasua", image: "🧋", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p14", name: "Trà đào cam sả", price: 45000, catId: "tra", fav: true, image: "🍑", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p15", name: "Trà vải", price: 42000, catId: "tra", image: "🍒", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p16", name: "Trà tắc", price: 32000, catId: "tra", image: "🍋", sugar: true, ice: true },
  { id: "p17", name: "Trà ổi hồng", price: 45000, catId: "tra", image: "🌺", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p18", name: "Matcha đá xay", price: 55000, catId: "daxay", fav: true, image: "🥤", sizes: SIZE_ML, sugar: true, toppings: TOPPING_DRINK },
  { id: "p19", name: "Socola đá xay", price: 55000, catId: "daxay", image: "🍫", sizes: SIZE_ML, sugar: true },
  { id: "p20", name: "Cookie đá xay", price: 59000, catId: "daxay", image: "🍪", sizes: SIZE_ML },
  { id: "p21", name: "Bánh tiramisu", price: 45000, catId: "banh", fav: true, image: "🍰" },
  { id: "p22", name: "Bánh mousse chanh dây", price: 42000, catId: "banh", image: "🍋" },
  { id: "p23", name: "Croissant bơ", price: 32000, catId: "banh", image: "🥐" },
  { id: "p24", name: "Bánh phô mai nướng", price: 39000, catId: "banh", image: "🧀" },
  { id: "p25", name: "Cookie socola", price: 22000, catId: "banh", image: "🍪" },
  { id: "p26", name: "Nước suối", price: 10000, catId: "chai", image: "💧" },
  { id: "p27", name: "Coca", price: 15000, catId: "chai", image: "🥤" },
  { id: "p28", name: "7Up", price: 15000, catId: "chai" }, // không ảnh → demo fallback
];

function hasOptions(p: ProductV4): boolean {
  return !!(p.sizes?.length || p.sugar || p.ice || p.toppings?.length);
}

interface Selection {
  sizeId?: string; sugar?: string; ice?: string;
  toppingQtys: Record<string, number>;
  note: string; quantity: number;
}
interface CartLineV4 { lineId: string; product: ProductV4; selection: Selection }

function defaultSelection(p: ProductV4): Selection {
  return {
    sizeId: p.sizes?.[0]?.id,
    sugar: p.sugar ? "70%" : undefined,
    ice: p.ice ? "Vừa đá" : undefined,
    toppingQtys: {}, note: "", quantity: 1,
  };
}
function unitPriceOf(p: ProductV4, s: Selection): number {
  const sd = p.sizes?.find((x) => x.id === s.sizeId)?.priceDelta ?? 0;
  const tt = (p.toppings ?? []).reduce((a, t) => a + t.price * (s.toppingQtys[t.id] ?? 0), 0);
  return p.price + sd + tt;
}
function selectionSummary(p: ProductV4, s: Selection): string {
  const parts: string[] = [];
  const sz = p.sizes?.find((x) => x.id === s.sizeId);
  if (sz) parts.push(`Size ${sz.label}`);
  if (s.sugar && s.sugar !== "100%") parts.push(`đường ${s.sugar}`);
  if (s.ice && s.ice !== "Vừa đá") parts.push(s.ice.toLowerCase());
  (p.toppings ?? []).forEach((t) => {
    const q = s.toppingQtys[t.id] ?? 0;
    if (q > 0) parts.push(`${t.name}${q > 1 ? ` x${q}` : ""}`);
  });
  if (s.note) parts.push(`“${s.note}”`);
  return parts.join(" · ");
}

// Bỏ dấu để search tiếng Việt không cần gõ dấu
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

// ── Sample tables ──
type TableStatus = "free" | "occupied" | "reserved" | "cleaning";
interface SampleTable { id: string; name: string; zone: string; cap: number; status: TableStatus; elapsed?: string; total?: number }
const ZONES = ["Tầng 1", "Sân vườn", "VIP"] as const;
const SAMPLE_TABLES: SampleTable[] = [
  { id: "b1", name: "Bàn 1", zone: "Tầng 1", cap: 4, status: "occupied", elapsed: "32:10", total: 215000 },
  { id: "b2", name: "Bàn 2", zone: "Tầng 1", cap: 4, status: "free" },
  { id: "b3", name: "Bàn 3", zone: "Tầng 1", cap: 2, status: "occupied", elapsed: "8:20", total: 88000 },
  { id: "b4", name: "Bàn 4", zone: "Tầng 1", cap: 4, status: "free" },
  { id: "b5", name: "Bàn 5", zone: "Tầng 1", cap: 4, status: "occupied", elapsed: "1:45", total: 143000 },
  { id: "b6", name: "Bàn 6", zone: "Tầng 1", cap: 6, status: "reserved" },
  { id: "b7", name: "Bàn 7", zone: "Tầng 1", cap: 2, status: "cleaning" },
  { id: "b8", name: "Bàn 8", zone: "Tầng 1", cap: 4, status: "free" },
  { id: "sv1", name: "SV-01", zone: "Sân vườn", cap: 4, status: "occupied", elapsed: "12:00", total: 175000 },
  { id: "sv2", name: "SV-02", zone: "Sân vườn", cap: 4, status: "free" },
  { id: "sv3", name: "SV-03", zone: "Sân vườn", cap: 6, status: "free" },
  { id: "sv4", name: "SV-04", zone: "Sân vườn", cap: 2, status: "occupied", elapsed: "22:30", total: 99000 },
  { id: "vip1", name: "VIP-1", zone: "VIP", cap: 8, status: "occupied", elapsed: "1:05:00", total: 1250000 },
  { id: "vip2", name: "VIP-2", zone: "VIP", cap: 8, status: "reserved" },
];

const TOP_FAVS = PRODUCTS.filter((p) => p.fav).slice(0, 6);

export default function PosFnbV4Mockup() {
  const [view, setView] = useState<"menu" | "floor">("menu");
  const [activeCat, setActiveCat] = useState<string>("fav");
  const [activeZone, setActiveZone] = useState<string>("Tầng 1");
  const [lines, setLines] = useState<CartLineV4[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [modifier, setModifier] = useState<{ product: ProductV4; lineId: string | null; sel: Selection } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const products = useMemo(() => {
    if (search.trim()) {
      const q = normalize(search.trim());
      return PRODUCTS.filter((p) => normalize(p.name).includes(q));
    }
    return activeCat === "fav" ? PRODUCTS.filter((p) => p.fav) : PRODUCTS.filter((p) => p.catId === activeCat);
  }, [search, activeCat]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { fav: PRODUCTS.filter((p) => p.fav).length };
    CATS.forEach((c) => { if (c.id !== "fav") m[c.id] = PRODUCTS.filter((p) => p.catId === c.id).length; });
    return m;
  }, []);
  const subtotal = lines.reduce((s, l) => s + unitPriceOf(l.product, l.selection) * l.selection.quantity, 0);
  const lineCount = lines.reduce((s, l) => s + l.selection.quantity, 0);

  function flash(msg: string) { setToast(msg); window.setTimeout(() => setToast(null), 1500); }

  function tapProduct(p: ProductV4) {
    if (hasOptions(p)) {
      setModifier({ product: p, lineId: null, sel: defaultSelection(p) });
    } else {
      setLines((prev) => {
        const ex = prev.find((l) => l.product.id === p.id && !l.selection.note);
        if (ex) return prev.map((l) => l.lineId === ex.lineId ? { ...l, selection: { ...l.selection, quantity: l.selection.quantity + 1 } } : l);
        return [...prev, { lineId: `L${Date.now()}`, product: p, selection: defaultSelection(p) }];
      });
      flash(`+1 ${p.name}`);
    }
  }
  function confirmModifier() {
    if (!modifier) return;
    const { product, lineId, sel } = modifier;
    if (lineId) {
      setLines((prev) => prev.map((l) => l.lineId === lineId ? { ...l, selection: sel } : l));
      flash(`Đã cập nhật ${product.name}`);
    } else {
      setLines((prev) => [...prev, { lineId: `L${Date.now()}`, product, selection: sel }]);
      flash(`+${sel.quantity} ${product.name}`);
    }
    setModifier(null);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Banner */}
      <div className="shrink-0 bg-primary-fixed px-4 py-1.5 text-xs text-primary">
        <Icon name="palette" size={14} className="mr-1 inline-block align-text-bottom" />
        <span className="font-semibold">MOCKUP v4 — optimised.</span>{" "}
        <span className="opacity-80">
          Mới: ô món có ảnh (fallback icon khi chưa có) · thanh tìm món · thanh “Bán chạy nhanh”.
        </span>
      </div>

      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-outline-variant/20 bg-card/95 px-4 py-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary">
          <Icon name="local_cafe" size={20} />
        </div>
        <h1 className="font-heading text-sm font-bold md:text-base">Quán Cà Phê OneBiz — Bàn 5</h1>

        <div className="ml-3 hidden items-center rounded-lg border border-outline-variant/30 bg-surface-container-low p-0.5 md:flex">
          {([
            { key: "menu", label: "Thực đơn", icon: "grid_view" },
            { key: "floor", label: "Sơ đồ bàn", icon: "table_bar" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors press-scale-sm",
                view === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="rounded-lg bg-surface-container px-3 py-1.5 font-heading text-base font-bold tabular-nums">09:24</div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex size-9 items-center justify-center rounded-lg border border-outline-variant/30 bg-card text-muted-foreground hover:bg-surface-container hover:text-foreground press-scale-sm"
            title="Cài đặt POS"
            aria-label="Cài đặt"
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {view === "menu" ? (
          <>
            <aside className="hidden w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-outline-variant/20 bg-surface-container-lowest p-2 lg:flex">
              {CATS.map((c) => {
                const active = activeCat === c.id && !search;
                return (
                  <button
                    key={c.id}
                    onClick={() => { setActiveCat(c.id); setSearch(""); }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors press-scale-sm",
                      active ? "font-semibold text-foreground" : "text-on-surface-variant hover:bg-surface-container",
                    )}
                    style={active ? { backgroundColor: `${c.color}1f` } : undefined}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-white" style={{ backgroundColor: c.color }}>
                      <Icon name={c.icon} size={14} />
                    </span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span
                      className="shrink-0 rounded-md px-1.5 text-[10px] font-semibold tabular-nums"
                      style={{ backgroundColor: active ? c.color : "var(--color-surface-container)", color: active ? "#fff" : undefined }}
                    >
                      {counts[c.id] ?? 0}
                    </span>
                  </button>
                );
              })}
            </aside>

            <div className="flex flex-1 min-w-0 flex-col">
              {/* SEARCH BAR — sticky */}
              <div className="sticky top-0 z-10 border-b border-outline-variant/15 bg-background/95 px-3 py-2 backdrop-blur">
                <div className="relative">
                  <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm món (gõ ‘ca phe’, ‘tra sua’, ‘banh’…)"
                    className="h-10 w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest pl-9 pr-9 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container"
                      aria-label="Xoá tìm kiếm"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* BÁN CHẠY NHANH — strip chip-mini luôn-hiện (ẩn khi đang tìm hoặc đã ở "Bán chạy") */}
              {!search && activeCat !== "fav" && (
                <div className="border-b border-outline-variant/15 bg-surface-container-lowest/60 px-3 py-2">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-status-warning">
                    <Icon name="star" size={11} /> Bán chạy nhanh
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {TOP_FAVS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => tapProduct(p)}
                        className="inline-flex h-12 shrink-0 items-center gap-2 rounded-lg border border-outline-variant/30 bg-card pl-1.5 pr-3 text-left transition-all press-scale-sm hover:ambient-shadow hover:border-primary/30"
                      >
                        <ImageOrIcon product={p} size={36} emojiSize={20} />
                        <div className="min-w-0">
                          <div className="truncate font-heading text-[12px] font-semibold leading-tight">{p.name}</div>
                          <div className="text-[11px] font-bold tabular-nums text-primary">{formatCurrency(p.price)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Lưới món */}
              <div className="flex-1 overflow-y-auto p-3">
                {products.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Icon name="search_off" size={32} />
                    <p className="text-sm">Không tìm thấy món nào</p>
                    {search && (
                      <button onClick={() => setSearch("")} className="text-xs text-primary underline">
                        Xoá tìm kiếm
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {products.map((p) => {
                      const opt = hasOptions(p);
                      const inCart = lines.filter((l) => l.product.id === p.id).reduce((s, l) => s + l.selection.quantity, 0);
                      return (
                        <button
                          key={p.id}
                          onClick={() => tapProduct(p)}
                          className="group relative flex h-20 items-center gap-2.5 overflow-hidden rounded-lg border border-outline-variant/20 bg-card pl-2 pr-2.5 text-left transition-all duration-150 press-scale-sm hover:ambient-shadow hover:border-outline-variant/40"
                        >
                          <ImageOrIcon product={p} size={56} emojiSize={30} />
                          <div className="min-w-0 flex-1">
                            <h3 className="line-clamp-2 font-heading text-[13px] font-semibold leading-tight text-foreground">{p.name}</h3>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="text-xs font-bold tabular-nums text-primary">{formatCurrency(p.price)}</span>
                              {opt ? (
                                <span className="inline-flex items-center gap-0.5 rounded bg-primary-fixed px-1 text-[9px] font-bold uppercase tracking-wider text-primary">
                                  <Icon name="tune" size={9} />Tuỳ chọn
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                                  <Icon name="bolt" size={9} />1 chạm
                                </span>
                              )}
                            </div>
                          </div>
                          {p.fav && (
                            <Icon name="star" size={12} className="absolute right-1.5 top-1.5 text-status-warning" />
                          )}
                          {inCart > 0 && (
                            <span className="absolute bottom-1.5 right-1.5 flex min-w-5 items-center justify-center rounded-full bg-status-success px-1 text-[10px] font-bold leading-4 text-white">
                              {inCart}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          // Sơ đồ bàn (giữ nguyên v3)
          <div className="flex-1 min-w-0 overflow-y-auto p-3">
            <div className="mb-3 flex items-center gap-1 rounded-lg border border-outline-variant/30 bg-surface-container-low p-0.5">
              {ZONES.map((z) => (
                <button
                  key={z}
                  onClick={() => setActiveZone(z)}
                  className={cn(
                    "h-8 rounded-md px-3 text-xs font-semibold transition-colors press-scale-sm",
                    activeZone === z ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {z}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-3 px-2 text-[10px] font-semibold uppercase tracking-wider">
                <Legend color="bg-surface-container-high" label="Trống" />
                <Legend color="bg-status-success/20" border="border-status-success/40" label="Đang dùng" />
                <Legend color="bg-status-warning/15" border="border-status-warning/40" label="Đặt trước" />
                <Legend color="bg-status-info/15" border="border-status-info/40" label="Đang dọn" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {SAMPLE_TABLES.filter((t) => t.zone === activeZone).map((t) => (
                <TableCard key={t.id} t={t} />
              ))}
            </div>
          </div>
        )}

        {/* Giỏ hàng */}
        <aside className="hidden w-[340px] shrink-0 flex-col border-l border-outline-variant/20 bg-surface-container-lowest lg:flex xl:w-[380px]">
          <div className="shrink-0 border-b border-outline-variant/20 p-3">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-sm font-bold">Bàn 5 — Tại quán</h2>
              {lineCount > 0 && (
                <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">{lineCount} món</span>
              )}
            </div>
          </div>
          {lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center text-muted-foreground">
              <Icon name="local_cafe" size={20} className="text-muted-foreground/50" />
              <p className="text-xs">Chưa có món — bấm thực đơn để thêm</p>
            </div>
          ) : (
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
              {lines.map((l) => (
                <CartLine
                  key={l.lineId}
                  line={l}
                  onInc={() => setLines((prev) => prev.map((x) => x.lineId === l.lineId ? { ...x, selection: { ...x.selection, quantity: x.selection.quantity + 1 } } : x))}
                  onDec={() => setLines((prev) => l.selection.quantity <= 1 ? prev.filter((x) => x.lineId !== l.lineId) : prev.map((x) => x.lineId === l.lineId ? { ...x, selection: { ...x.selection, quantity: x.selection.quantity - 1 } } : x))}
                  onRemove={() => setLines((prev) => prev.filter((x) => x.lineId !== l.lineId))}
                  onEdit={() => setModifier({ product: l.product, lineId: l.lineId, sel: l.selection })}
                />
              ))}
            </div>
          )}
          <div className="shrink-0 space-y-2.5 border-t border-outline-variant/20 p-3">
            <div className="flex items-end justify-between">
              <span className="pb-0.5 text-xs font-semibold text-muted-foreground">Khách cần trả</span>
              <span className="font-heading text-2xl font-black leading-none tabular-nums text-primary">
                {formatCurrency(subtotal)}<span className="ml-1 text-sm font-bold">đ</span>
              </span>
            </div>
            <div className="flex gap-2">
              <button className="h-11 flex-[0.4] rounded-lg bg-surface-container-high text-xs font-semibold text-on-surface disabled:opacity-40" disabled={lines.length === 0}>
                <Icon name="notifications_active" size={14} className="mr-1 inline-block align-text-bottom" />Bếp
              </button>
              <button className="h-11 flex-[0.6] rounded-lg bg-primary text-xs font-bold text-on-primary ambient-shadow disabled:opacity-40" disabled={lines.length === 0}>
                <Icon name="payments" size={14} className="mr-1 inline-block align-text-bottom" />Thanh toán
              </button>
            </div>
          </div>
        </aside>
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-status-success px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {modifier && (
        <ModifierSheet state={modifier} onChange={setModifier} onConfirm={confirmModifier} onClose={() => setModifier(null)} />
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onAction={flash} />}
    </div>
  );
}

// ── Image or fallback icon ──
function ImageOrIcon({ product, size, emojiSize }: { product: ProductV4; size: number; emojiSize: number }) {
  const c = CAT_BY[product.catId];
  const color = c?.color ?? "#999";
  if (product.image) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-lg"
        style={{ width: size, height: size, backgroundColor: `${color}1f`, fontSize: emojiSize, lineHeight: 1 }}
        aria-hidden
      >
        {product.image}
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg text-white"
      style={{ width: size, height: size, backgroundColor: color }}
    >
      <Icon name={c?.icon ?? "local_cafe"} size={Math.round(size * 0.45)} />
    </span>
  );
}

// ════════════════════════════════════════════════════════════════
// (Modifier + Cart + Table + Settings — y v3, không đụng)
// ════════════════════════════════════════════════════════════════
function ModifierSheet({
  state, onChange, onConfirm, onClose,
}: {
  state: { product: ProductV4; lineId: string | null; sel: Selection };
  onChange: (s: { product: ProductV4; lineId: string | null; sel: Selection }) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { product: p, sel } = state;
  const set = (patch: Partial<Selection>) => onChange({ ...state, sel: { ...sel, ...patch } });
  const unit = unitPriceOf(p, sel);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-container-lowest sm:max-w-[420px] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-outline-variant/15 px-4 py-3">
          <ImageOrIcon product={p} size={44} emojiSize={26} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-heading text-base font-bold leading-tight">{p.name}</h2>
            <p className="text-[11px] text-muted-foreground">Giá gốc {formatCurrency(p.price)}</p>
          </div>
          <button onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container" aria-label="Đóng">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-3">
          {p.sizes && p.sizes.length > 0 && (
            <GroupRow title="Size" rule="Bắt buộc">
              <ChipRow>
                {p.sizes.map((s) => (
                  <Chip key={s.id} active={sel.sizeId === s.id} onClick={() => set({ sizeId: s.id })}>
                    {s.label}{s.priceDelta > 0 && <span className="ml-1 text-[10px] opacity-70">+{Math.round(s.priceDelta / 1000)}k</span>}
                  </Chip>
                ))}
              </ChipRow>
            </GroupRow>
          )}

          {p.sugar && (
            <GroupRow title="Mức đường">
              <ChipRow>
                {SWEETNESS.map((s) => (
                  <Chip key={s} active={sel.sugar === s} onClick={() => set({ sugar: s })}>{s}</Chip>
                ))}
              </ChipRow>
            </GroupRow>
          )}

          {p.ice && (
            <GroupRow title="Mức đá">
              <ChipRow>
                {ICE.map((s) => (
                  <Chip key={s} active={sel.ice === s} onClick={() => set({ ice: s })}>{s}</Chip>
                ))}
              </ChipRow>
            </GroupRow>
          )}

          {p.toppings && p.toppings.length > 0 && (
            <GroupRow title="Topping" rule="Tính phí">
              <div className="flex flex-wrap gap-1.5">
                {p.toppings.map((t) => {
                  const q = sel.toppingQtys[t.id] ?? 0;
                  const on = q > 0;
                  return (
                    <button
                      key={t.id}
                      onClick={() => set({ toppingQtys: { ...sel.toppingQtys, [t.id]: on ? 0 : 1 } })}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors press-scale-sm",
                        on
                          ? "border-primary bg-primary-fixed text-primary"
                          : "border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
                      )}
                    >
                      <span className="leading-none">{t.name}</span>
                      <span className="text-[10px] opacity-70">+{Math.round(t.price / 1000)}k</span>
                      {on && (
                        <span
                          className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-primary px-1 py-0.5 text-white"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); set({ toppingQtys: { ...sel.toppingQtys, [t.id]: Math.max(0, q - 1) } }); }}
                            className="flex size-5 items-center justify-center rounded-full hover:bg-white/15"
                          >
                            <Icon name="remove" size={11} />
                          </span>
                          <span className="min-w-[10px] text-center text-[11px] font-bold tabular-nums">{q}</span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); set({ toppingQtys: { ...sel.toppingQtys, [t.id]: Math.min(10, q + 1) } }); }}
                            className="flex size-5 items-center justify-center rounded-full hover:bg-white/15"
                          >
                            <Icon name="add" size={11} />
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </GroupRow>
          )}

          <GroupRow title="Ghi chú">
            <ChipRow>
              {NOTE_PRESETS.map((n) => {
                const on = sel.note.split(", ").includes(n);
                return (
                  <Chip
                    key={n}
                    active={on}
                    onClick={() => {
                      const cur = sel.note ? sel.note.split(", ").filter(Boolean) : [];
                      const next = on ? cur.filter((x) => x !== n) : [...cur, n];
                      set({ note: next.join(", ") });
                    }}
                  >
                    {n}
                  </Chip>
                );
              })}
            </ChipRow>
            <input
              value={sel.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="Hoặc gõ ghi chú tự do…"
              maxLength={120}
              className="mt-2 w-full rounded-lg border border-outline-variant/30 bg-background px-3 py-2 text-xs"
            />
          </GroupRow>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-outline-variant/15 px-4 py-3">
          <div className="inline-flex h-11 items-center gap-0.5 rounded-full border border-outline-variant/20 bg-surface-container-low p-0.5">
            <button onClick={() => set({ quantity: Math.max(1, sel.quantity - 1) })} className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container-high" aria-label="Giảm">
              <Icon name="remove" size={16} />
            </button>
            <span className="w-7 text-center text-sm font-bold tabular-nums">{sel.quantity}</span>
            <button onClick={() => set({ quantity: sel.quantity + 1 })} className="flex size-9 items-center justify-center rounded-full text-primary hover:bg-primary-fixed" aria-label="Tăng">
              <Icon name="add" size={16} />
            </button>
          </div>
          <button onClick={onConfirm} className="flex h-11 flex-1 items-center justify-between gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-on-primary ambient-shadow press-scale-sm">
            <span>{state.lineId ? "Cập nhật" : "Thêm vào giỏ"}</span>
            <span className="tabular-nums">{formatCurrency(unit * sel.quantity)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupRow({ title, rule, children }: { title: string; rule?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{title}</span>
        {rule && (
          <span className="rounded bg-surface-container px-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{rule}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-w-[44px] items-center justify-center rounded-full border px-3.5 text-xs font-medium transition-colors press-scale-sm",
        active
          ? "border-primary bg-primary text-on-primary"
          : "border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
      )}
    >
      {children}
    </button>
  );
}

function CartLine({
  line, onInc, onDec, onRemove, onEdit,
}: {
  line: CartLineV4; onInc: () => void; onDec: () => void; onRemove: () => void; onEdit: () => void;
}) {
  const unit = unitPriceOf(line.product, line.selection);
  const summary = selectionSummary(line.product, line.selection);
  return (
    <div className="rounded-lg bg-surface-container-low p-2.5">
      <div className="flex items-start gap-2">
        <ImageOrIcon product={line.product} size={36} emojiSize={20} />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold leading-tight">{line.product.name}</p>
          {summary && <p className="mt-0.5 text-[11px] text-muted-foreground">{summary}</p>}
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums text-primary">{formatCurrency(unit * line.selection.quantity)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-outline-variant/15 bg-surface-container-lowest p-0.5">
          <button onClick={onDec} className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container-high" aria-label="Giảm">
            <Icon name="remove" size={14} />
          </button>
          <span className="w-6 text-center text-xs font-semibold tabular-nums">{line.selection.quantity}</span>
          <button onClick={onInc} className="flex size-8 items-center justify-center rounded-full text-primary hover:bg-primary-fixed" aria-label="Tăng">
            <Icon name="add" size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          {hasOptions(line.product) && (
            <button onClick={onEdit} className="inline-flex h-8 items-center gap-1 rounded-md border border-outline-variant/40 px-2.5 text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container">
              <Icon name="tune" size={12} />Sửa
            </button>
          )}
          <button onClick={onRemove} className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-status-error/10 hover:text-status-error" aria-label="Xoá">
            <Icon name="delete" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TableCard({ t }: { t: SampleTable }) {
  const cfg = {
    free: { bg: "bg-surface-container-low", border: "border-outline-variant/30", text: "text-foreground", label: "Trống", icon: "table_bar" },
    occupied: { bg: "bg-status-success/10", border: "border-status-success/40", text: "text-status-success", label: "Đang dùng", icon: "groups" },
    reserved: { bg: "bg-status-warning/10", border: "border-status-warning/40", text: "text-status-warning", label: "Đặt trước", icon: "bookmark" },
    cleaning: { bg: "bg-status-info/10", border: "border-status-info/40", text: "text-status-info", label: "Đang dọn", icon: "cleaning_services" },
  }[t.status];
  return (
    <button className={cn("flex h-32 flex-col items-stretch overflow-hidden rounded-xl border-2 p-2.5 text-left transition-all press-scale-sm hover:ambient-shadow", cfg.bg, cfg.border)}>
      <div className="flex items-center justify-between">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", cfg.text)}>
          <Icon name={cfg.icon} size={11} />{cfg.label}
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">{t.cap} chỗ</span>
      </div>
      <div className="mt-1 flex-1">
        <div className={cn("font-heading text-2xl font-extrabold leading-none", cfg.text)}>{t.name}</div>
        {t.status === "occupied" && (
          <div className="mt-2 space-y-0.5 text-[11px] text-on-surface-variant">
            <div className="flex items-center gap-1"><Icon name="schedule" size={11} /><span className="tabular-nums">{t.elapsed}</span></div>
            <div className="font-bold tabular-nums text-foreground">{formatCurrency(t.total ?? 0)}đ</div>
          </div>
        )}
      </div>
    </button>
  );
}

function Legend({ color, border, label }: { color: string; border?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className={cn("inline-block size-3 rounded border", color, border ?? "border-outline-variant/40")} />
      {label}
    </span>
  );
}

function SettingsPanel({ onClose, onAction }: { onClose: () => void; onAction: (msg: string) => void }) {
  const ITEMS: { icon: string; title: string; desc: string }[] = [
    { icon: "print", title: "Máy in & Phiếu bếp", desc: "Khổ giấy, in tự động, máy in theo trạm" },
    { icon: "tune", title: "Hiển thị POS", desc: "Tile ngang/dọc, ẩn món giá 0đ, mặc định loại đơn" },
    { icon: "volume_up", title: "Âm thanh KDS", desc: "Bật/tắt beep đơn mới, cảnh báo quá hạn" },
    { icon: "work_history", title: "Ca làm việc", desc: "Mở/đóng ca, tiền mặt đầu ca, in tổng kết" },
    { icon: "keyboard", title: "Phím tắt", desc: "Tuỳ chỉnh F3/F4/F9/F10 và hotkey món" },
    { icon: "wifi", title: "Mạng & Offline", desc: "Ưu tiên LAN, cache bản đồ menu, đồng bộ lại" },
    { icon: "person", title: "Quyền & OTP", desc: "Huỷ đơn, giảm giá, mở két — uỷ quyền OTP quản lý" },
    { icon: "lock", title: "Khoá phiên", desc: "Auto-lock sau N phút không thao tác" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-sm flex-col overflow-hidden bg-surface-container-lowest shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-3 border-b border-outline-variant/15 px-4 py-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary-subtle text-primary">
            <Icon name="settings" size={18} />
          </div>
          <h2 className="flex-1 font-heading text-base font-bold">Cài đặt POS</h2>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container" aria-label="Đóng">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {ITEMS.map((it) => (
            <button
              key={it.title}
              onClick={() => onAction(`Mở: ${it.title}`)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-container"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant">
                <Icon name={it.icon} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{it.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">{it.desc}</p>
              </div>
              <Icon name="chevron_right" size={16} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="shrink-0 border-t border-outline-variant/15 p-3 text-[10px] text-muted-foreground">
          Mockup minh hoạ — bấm 1 mục để xem toast “Mở: …”.
        </div>
      </div>
    </div>
  );
}
