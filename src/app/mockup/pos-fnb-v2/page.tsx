"use client";

/**
 * MOCKUP — POS F&B "Cách bấm món" cải tiến (đề xuất)
 * Route: /mockup/pos-fnb-v2
 *
 * CEO 29/05/2026: "làm 1 bộ mockup" sau báo cáo học hỏi Fabi/KiotViet/CukCuk.
 * Demo tương tác 3 cải tiến (P1+P2):
 *   1. Bảng tuỳ chọn THEO NHÓM kiểu Fabi: Size (chọn 1) · Đường (chọn 1) ·
 *      Đá (chọn 1) · Topping (chọn nhiều, theo từng món) → mở cho MỌI món có
 *      tuỳ chọn, không chỉ món có size. Món đơn giản vẫn 1 chạm.
 *   2. Nút "Sửa" trên từng dòng giỏ → mở lại bảng tuỳ chọn để chỉnh.
 *   3. Ghim "Bán chạy" lên đầu + màu danh mục + nhãn "Tuỳ chọn" trên ô món.
 *
 * Đây là MOCKUP — dữ liệu giả, không đụng hệ thống thật.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

// ── Option model (kiểu Fabi: mỗi món gắn nhóm tuỳ chọn riêng) ──
interface SizeOpt {
  id: string;
  label: string;
  priceDelta: number;
}
interface ToppingOpt {
  id: string;
  name: string;
  price: number;
}
interface ProductV2 {
  id: string;
  name: string;
  price: number;
  catId: string;
  fav?: boolean;
  sizes?: SizeOpt[]; // chọn 1, bắt buộc (nếu có)
  sugar?: boolean; // có mức đường
  ice?: boolean; // có mức đá
  toppings?: ToppingOpt[]; // chọn nhiều (theo món)
}

const SWEETNESS = ["Không đường", "30%", "50%", "70%", "100%"] as const;
const ICE = ["Không đá", "Ít đá", "Vừa đá", "Nhiều đá"] as const;
const NOTE_PRESETS = ["Mang đi", "Nóng", "Ít ngọt", "Riêng đá", "Không ống hút"] as const;

const CATS: { id: string; name: string; icon: string; color: string }[] = [
  { id: "fav", name: "Bán chạy", icon: "star", color: "#f59e0b" },
  { id: "cafe", name: "Cà phê", icon: "local_cafe", color: "#a16207" },
  { id: "trasua", name: "Trà sữa", icon: "bubble_chart", color: "#db2777" },
  { id: "tra", name: "Trà trái cây", icon: "emoji_food_beverage", color: "#16a34a" },
  { id: "banh", name: "Bánh ngọt", icon: "bakery_dining", color: "#9333ea" },
  { id: "chai", name: "Đóng chai", icon: "local_drink", color: "#0891b2" },
];
const CAT_COLOR: Record<string, string> = Object.fromEntries(CATS.map((c) => [c.id, c.color]));

const SIZE_ML: SizeOpt[] = [
  { id: "m", label: "M", priceDelta: 0 },
  { id: "l", label: "L", priceDelta: 6000 },
];
const TOPPING_DRINK: ToppingOpt[] = [
  { id: "tc-den", name: "Trân châu đen", price: 7000 },
  { id: "tc-trang", name: "Trân châu trắng", price: 7000 },
  { id: "thach", name: "Thạch phô mai", price: 8000 },
  { id: "kem", name: "Kem cheese", price: 10000 },
];

const PRODUCTS: ProductV2[] = [
  { id: "p1", name: "Cà phê sữa đá", price: 29000, catId: "cafe", fav: true, sizes: SIZE_ML, sugar: true, ice: true, toppings: [] },
  { id: "p2", name: "Bạc xỉu", price: 35000, catId: "cafe", fav: true, sizes: SIZE_ML, sugar: true, ice: true },
  { id: "p3", name: "Cà phê đen đá", price: 25000, catId: "cafe", sugar: true, ice: true },
  { id: "p4", name: "Cà phê muối", price: 39000, catId: "cafe", sizes: SIZE_ML, sugar: true, ice: true, toppings: [] },
  { id: "p5", name: "Cappuccino", price: 45000, catId: "cafe" }, // không tuỳ chọn → 1 chạm
  { id: "p6", name: "Trà sữa trân châu đường đen", price: 45000, catId: "trasua", fav: true, sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p7", name: "Trà sữa truyền thống", price: 39000, catId: "trasua", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p8", name: "Trà sữa matcha", price: 45000, catId: "trasua", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p9", name: "Trà đào cam sả", price: 45000, catId: "tra", fav: true, sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p10", name: "Trà vải", price: 42000, catId: "tra", sizes: SIZE_ML, sugar: true, ice: true, toppings: TOPPING_DRINK },
  { id: "p11", name: "Trà tắc", price: 32000, catId: "tra", sugar: true, ice: true },
  { id: "p12", name: "Bánh tiramisu", price: 45000, catId: "banh" }, // 1 chạm
  { id: "p13", name: "Croissant bơ", price: 32000, catId: "banh" }, // 1 chạm
  { id: "p14", name: "Cookie socola", price: 22000, catId: "banh" }, // 1 chạm
  { id: "p15", name: "Nước suối", price: 10000, catId: "chai" }, // 1 chạm
  { id: "p16", name: "Coca", price: 15000, catId: "chai" }, // 1 chạm
];

function hasOptions(p: ProductV2): boolean {
  return !!(p.sizes?.length || p.sugar || p.ice || p.toppings?.length);
}

interface Selection {
  sizeId?: string;
  sugar?: string;
  ice?: string;
  toppingQtys: Record<string, number>;
  note: string;
  quantity: number;
}
interface CartLineV2 {
  lineId: string;
  product: ProductV2;
  selection: Selection;
}

function defaultSelection(p: ProductV2): Selection {
  return {
    sizeId: p.sizes?.[0]?.id,
    sugar: p.sugar ? "70%" : undefined,
    ice: p.ice ? "Vừa đá" : undefined,
    toppingQtys: {},
    note: "",
    quantity: 1,
  };
}

function unitPriceOf(p: ProductV2, s: Selection): number {
  const sizeDelta = p.sizes?.find((x) => x.id === s.sizeId)?.priceDelta ?? 0;
  const topSum = (p.toppings ?? []).reduce(
    (acc, t) => acc + t.price * (s.toppingQtys[t.id] ?? 0),
    0,
  );
  return p.price + sizeDelta + topSum;
}

function selectionSummary(p: ProductV2, s: Selection): string {
  const parts: string[] = [];
  const size = p.sizes?.find((x) => x.id === s.sizeId);
  if (size) parts.push(`Size ${size.label}`);
  if (s.sugar) parts.push(s.sugar === "100%" ? "đường 100%" : `đường ${s.sugar}`);
  if (s.ice) parts.push(s.ice.toLowerCase());
  (p.toppings ?? []).forEach((t) => {
    const q = s.toppingQtys[t.id] ?? 0;
    if (q > 0) parts.push(`${t.name}${q > 1 ? ` x${q}` : ""}`);
  });
  if (s.note) parts.push(`“${s.note}”`);
  return parts.join(" · ");
}

export default function PosFnbV2Mockup() {
  const [activeCat, setActiveCat] = useState<string>("fav");
  const [lines, setLines] = useState<CartLineV2[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  // modifier: mở bảng tuỳ chọn. lineId=null → thêm mới; có lineId → sửa dòng.
  const [modifier, setModifier] = useState<{ product: ProductV2; lineId: string | null; sel: Selection } | null>(null);

  const products = useMemo(
    () => (activeCat === "fav" ? PRODUCTS.filter((p) => p.fav) : PRODUCTS.filter((p) => p.catId === activeCat)),
    [activeCat],
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = { fav: PRODUCTS.filter((p) => p.fav).length };
    CATS.forEach((c) => {
      if (c.id !== "fav") m[c.id] = PRODUCTS.filter((p) => p.catId === c.id).length;
    });
    return m;
  }, []);

  const subtotal = lines.reduce((s, l) => s + unitPriceOf(l.product, l.selection) * l.selection.quantity, 0);
  const lineCount = lines.reduce((s, l) => s + l.selection.quantity, 0);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1600);
  }

  function tapProduct(p: ProductV2) {
    if (hasOptions(p)) {
      setModifier({ product: p, lineId: null, sel: defaultSelection(p) });
    } else {
      // Món đơn giản → 1 chạm thêm thẳng (gộp nếu trùng)
      setLines((prev) => {
        const ex = prev.find((l) => l.product.id === p.id && !l.selection.note);
        if (ex)
          return prev.map((l) =>
            l.lineId === ex.lineId ? { ...l, selection: { ...l.selection, quantity: l.selection.quantity + 1 } } : l,
          );
        return [...prev, { lineId: `L${Date.now()}`, product: p, selection: defaultSelection(p) }];
      });
      flash(`+1 ${p.name}`);
    }
  }

  function confirmModifier() {
    if (!modifier) return;
    const { product, lineId, sel } = modifier;
    if (lineId) {
      setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, selection: sel } : l)));
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
        <span className="font-semibold">MOCKUP đề xuất — cách bấm món cải tiến.</span>{" "}
        <span className="opacity-80">
          Bấm “Cà phê sữa đá” hoặc “Trà sữa…” để thấy bảng tuỳ chọn theo nhóm. Bấm “Cappuccino/bánh/nước” để thấy 1 chạm thêm thẳng. Dòng trong giỏ có nút “Sửa”.
        </span>
      </div>

      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-outline-variant/20 bg-card/95 px-4 py-2.5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary">
          <Icon name="local_cafe" size={20} />
        </div>
        <h1 className="font-heading text-base font-bold">Quán Cà Phê OneBiz — Bàn 5</h1>
        <div className="ml-auto rounded-lg bg-surface-container px-3 py-1.5 font-heading text-lg font-bold tabular-nums">
          09:24
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar danh mục — có màu */}
        <aside className="hidden w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-outline-variant/20 bg-surface-container-lowest p-2 lg:flex">
          {CATS.map((c) => {
            const active = activeCat === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors press-scale-sm",
                  active ? "font-bold text-foreground" : "text-on-surface-variant hover:bg-surface-container",
                )}
                style={active ? { backgroundColor: `${c.color}1a` } : undefined}
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ backgroundColor: c.color }}
                >
                  <Icon name={c.icon} size={16} />
                </span>
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                  style={{ backgroundColor: active ? c.color : "var(--color-surface-container)", color: active ? "#fff" : undefined }}
                >
                  {counts[c.id] ?? 0}
                </span>
              </button>
            );
          })}
        </aside>

        {/* Lưới món */}
        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {products.map((p) => {
              const color = CAT_COLOR[p.catId] ?? "#a16207";
              const opt = hasOptions(p);
              const inCart = lines.filter((l) => l.product.id === p.id).reduce((s, l) => s + l.selection.quantity, 0);
              return (
                <button
                  key={p.id}
                  onClick={() => tapProduct(p)}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-transparent bg-surface-container-low text-left transition-all duration-200 press-scale-sm hover:bg-surface-container-lowest hover:ambient-shadow-elevated hover:border-outline-variant/20"
                >
                  {/* Ảnh placeholder tô theo màu danh mục */}
                  <div className="relative aspect-square p-2">
                    <div
                      className="flex h-full w-full items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${color}1f` }}
                    >
                      <Icon name={CATS.find((c) => c.id === p.catId)?.icon ?? "local_cafe"} size={30} style={{ color }} />
                    </div>
                    <div className="absolute right-3 top-3 rounded-full bg-primary/90 px-2.5 py-0.5 text-[11px] font-bold text-on-primary backdrop-blur-[20px]">
                      {formatCurrency(p.price)}
                    </div>
                    {p.fav && (
                      <div className="absolute left-3 top-3 flex size-6 items-center justify-center rounded-full bg-status-warning text-white">
                        <Icon name="star" size={13} />
                      </div>
                    )}
                    {inCart > 0 && (
                      <div className="absolute bottom-3 right-3 flex min-w-6 items-center justify-center rounded-full bg-status-success px-1.5 py-0.5 text-[11px] font-bold text-white">
                        {inCart}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 px-3 pb-2.5 pt-0.5">
                    <h3 className="line-clamp-2 font-heading text-sm font-semibold leading-tight text-foreground">{p.name}</h3>
                    {opt ? (
                      <span className="mt-1 inline-flex items-center gap-0.5 rounded-md bg-primary-fixed px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        <Icon name="tune" size={11} /> Tuỳ chọn
                      </span>
                    ) : (
                      <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground">
                        <Icon name="bolt" size={11} /> 1 chạm
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Giỏ hàng */}
        <aside className="hidden w-[360px] shrink-0 flex-col border-l border-outline-variant/20 bg-surface-container-lowest lg:flex xl:w-[400px]">
          <div className="shrink-0 border-b border-outline-variant/20 p-4">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-base font-bold">Bàn 5</h2>
              {lineCount > 0 && (
                <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                  {lineCount} món
                </span>
              )}
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
              <Icon name="local_cafe" size={22} className="text-muted-foreground/50" />
              <p className="text-xs">Chưa có món — bấm thực đơn để thêm</p>
            </div>
          ) : (
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {lines.map((l) => {
                const unit = unitPriceOf(l.product, l.selection);
                const summary = selectionSummary(l.product, l.selection);
                return (
                  <div key={l.lineId} className="rounded-lg bg-surface-container-low p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-heading text-sm font-semibold leading-tight">{l.product.name}</p>
                        {summary && <p className="mt-0.5 text-[11px] text-muted-foreground">{summary}</p>}
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-primary">
                        {formatCurrency(unit * l.selection.quantity)}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <div className="inline-flex items-center gap-0.5 rounded-full border border-outline-variant/15 bg-surface-container-lowest p-0.5">
                        <button
                          onClick={() =>
                            setLines((prev) =>
                              l.selection.quantity <= 1
                                ? prev.filter((x) => x.lineId !== l.lineId)
                                : prev.map((x) =>
                                    x.lineId === l.lineId
                                      ? { ...x, selection: { ...x.selection, quantity: x.selection.quantity - 1 } }
                                      : x,
                                  ),
                            )
                          }
                          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container-high"
                          aria-label="Giảm"
                        >
                          <Icon name="remove" size={16} />
                        </button>
                        <span className="w-7 text-center text-sm font-semibold tabular-nums">{l.selection.quantity}</span>
                        <button
                          onClick={() =>
                            setLines((prev) =>
                              prev.map((x) =>
                                x.lineId === l.lineId
                                  ? { ...x, selection: { ...x.selection, quantity: x.selection.quantity + 1 } }
                                  : x,
                              ),
                            )
                          }
                          className="flex size-9 items-center justify-center rounded-full text-primary hover:bg-primary-fixed"
                          aria-label="Tăng"
                        >
                          <Icon name="add" size={16} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        {hasOptions(l.product) && (
                          <button
                            onClick={() => setModifier({ product: l.product, lineId: l.lineId, sel: l.selection })}
                            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
                          >
                            <Icon name="tune" size={13} /> Sửa
                          </button>
                        )}
                        <button
                          onClick={() => setLines((prev) => prev.filter((x) => x.lineId !== l.lineId))}
                          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-status-error/10 hover:text-status-error"
                          aria-label="Xoá"
                        >
                          <Icon name="delete" size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div className="shrink-0 space-y-3 border-t border-outline-variant/20 p-4">
            <div className="flex items-end justify-between">
              <span className="pb-0.5 text-sm font-semibold">Khách cần trả</span>
              <span className="font-heading text-3xl font-black leading-none tabular-nums text-primary">
                {formatCurrency(subtotal)}
                <span className="ml-1 text-base font-bold">đ</span>
              </span>
            </div>
            <div className="flex gap-2">
              <button className="h-14 flex-[0.4] rounded-lg bg-surface-container-high text-sm font-semibold text-on-surface disabled:opacity-40" disabled={lines.length === 0}>
                <Icon name="notifications_active" size={16} className="mr-1 inline-block align-text-bottom" /> Bếp
              </button>
              <button className="h-14 flex-[0.6] rounded-lg bg-primary text-sm font-bold text-on-primary ambient-shadow disabled:opacity-40" disabled={lines.length === 0}>
                <Icon name="payments" size={16} className="mr-1 inline-block align-text-bottom" /> Thanh toán
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-status-success px-4 py-2 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* ── Bảng tuỳ chọn (modifier) ── */}
      {modifier && (
        <ModifierSheet
          state={modifier}
          onChange={setModifier}
          onConfirm={confirmModifier}
          onClose={() => setModifier(null)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Bảng tuỳ chọn theo nhóm — kiểu Fabi (Size chọn 1 · Đường chọn 1 ·
// Đá chọn 1 · Topping chọn nhiều). Có giá trị mặc định để bấm nhanh.
// ════════════════════════════════════════════════════════════════
function ModifierSheet({
  state,
  onChange,
  onConfirm,
  onClose,
}: {
  state: { product: ProductV2; lineId: string | null; sel: Selection };
  onChange: (s: { product: ProductV2; lineId: string | null; sel: Selection }) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { product: p, sel } = state;
  const set = (patch: Partial<Selection>) => onChange({ ...state, sel: { ...sel, ...patch } });
  const unit = unitPriceOf(p, sel);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-container-lowest sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-outline-variant/20 p-4">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-bold leading-tight">{p.name}</h2>
            <p className="text-xs text-muted-foreground">{formatCurrency(p.price)} · chọn tuỳ chọn bên dưới</p>
          </div>
          <button onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container" aria-label="Đóng">
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {p.sizes && p.sizes.length > 0 && (
            <Group title="Size" rule="Chọn 1 · bắt buộc">
              <div className="flex flex-wrap gap-2">
                {p.sizes.map((s) => (
                  <Chip key={s.id} active={sel.sizeId === s.id} onClick={() => set({ sizeId: s.id })}>
                    {s.label}
                    {s.priceDelta > 0 && <span className="ml-1 opacity-70">+{formatCurrency(s.priceDelta)}</span>}
                  </Chip>
                ))}
              </div>
            </Group>
          )}

          {p.sugar && (
            <Group title="Mức đường" rule="Chọn 1">
              <div className="flex flex-wrap gap-2">
                {SWEETNESS.map((s) => (
                  <Chip key={s} active={sel.sugar === s} onClick={() => set({ sugar: s })}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Group>
          )}

          {p.ice && (
            <Group title="Mức đá" rule="Chọn 1">
              <div className="flex flex-wrap gap-2">
                {ICE.map((s) => (
                  <Chip key={s} active={sel.ice === s} onClick={() => set({ ice: s })}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Group>
          )}

          {p.toppings && p.toppings.length > 0 && (
            <Group title="Topping" rule="Chọn nhiều · tính phí">
              <div className="space-y-1.5">
                {p.toppings.map((t) => {
                  const q = sel.toppingQtys[t.id] ?? 0;
                  return (
                    <div key={t.id} className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                      <div className="min-w-0">
                        <span className="text-sm font-medium">{t.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">+{formatCurrency(t.price)}</span>
                      </div>
                      <div className="inline-flex items-center gap-0.5 rounded-full border border-outline-variant/20 bg-surface-container-lowest p-0.5">
                        <button
                          onClick={() => set({ toppingQtys: { ...sel.toppingQtys, [t.id]: Math.max(0, q - 1) } })}
                          className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container-high disabled:opacity-30"
                          disabled={q === 0}
                          aria-label="Giảm topping"
                        >
                          <Icon name="remove" size={15} />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{q}</span>
                        <button
                          onClick={() => set({ toppingQtys: { ...sel.toppingQtys, [t.id]: Math.min(10, q + 1) } })}
                          className="flex size-8 items-center justify-center rounded-full text-primary hover:bg-primary-fixed"
                          aria-label="Tăng topping"
                        >
                          <Icon name="add" size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Group>
          )}

          <Group title="Ghi chú nhanh" rule="Tuỳ chọn">
            <div className="flex flex-wrap gap-2">
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
            </div>
            <input
              value={sel.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="Hoặc gõ ghi chú tự do…"
              maxLength={120}
              className="mt-2 w-full rounded-lg border border-outline-variant/30 bg-background px-3 py-2 text-sm"
            />
          </Group>
        </div>

        {/* Footer: qty + confirm */}
        <div className="flex shrink-0 items-center gap-3 border-t border-outline-variant/20 p-4">
          <div className="inline-flex items-center gap-0.5 rounded-full border border-outline-variant/20 bg-surface-container-low p-0.5">
            <button
              onClick={() => set({ quantity: Math.max(1, sel.quantity - 1) })}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-container-high"
              aria-label="Giảm"
            >
              <Icon name="remove" size={18} />
            </button>
            <span className="w-8 text-center text-base font-bold tabular-nums">{sel.quantity}</span>
            <button
              onClick={() => set({ quantity: sel.quantity + 1 })}
              className="flex size-10 items-center justify-center rounded-full text-primary hover:bg-primary-fixed"
              aria-label="Tăng"
            >
              <Icon name="add" size={18} />
            </button>
          </div>
          <button
            onClick={onConfirm}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-on-primary ambient-shadow press-scale-sm"
          >
            {state.lineId ? "Cập nhật" : "Thêm vào giỏ"}
            <span className="tabular-nums">· {formatCurrency(unit * sel.quantity)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Group({ title, rule, children }: { title: string; rule: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-bold text-foreground">{title}</span>
        <span className="rounded-md bg-surface-container px-1.5 py-0.5 text-[10px] font-semibold uppercase text-on-surface-variant">
          {rule}
        </span>
      </div>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-2 text-sm font-medium transition-colors press-scale-sm",
        active
          ? "border-primary bg-primary text-on-primary"
          : "border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
      )}
    >
      {children}
    </button>
  );
}
