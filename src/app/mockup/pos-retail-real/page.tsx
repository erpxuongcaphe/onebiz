"use client";

/**
 * MOCKUP "GẦN THẬT" — POS Retail (CEO 15/06/2026, Cách 1).
 * Bám ĐÚNG field/luồng POS Retail thật (src/app/pos/page.tsx): nhiều đơn,
 * chọn khách, Tổng tiền hàng / Giảm giá / Chiết khấu đơn (OTP) / Mã KM /
 * VAT đơn 0-5-8-10% / Khách cần trả, 4 cách TT + chi tiết Hỗn hợp,
 * Khách đưa + mệnh giá + Thừa/Nợ, Ghi chú, In bill, In tạm tính, Bán nhanh.
 * Dữ liệu MẪU, KHÔNG gọi service / KHÔNG đụng POS thật.
 *
 * Cải tiến áp vào (so với hiện tại): tổng tiền TO hơn, ô tìm/quét nổi bật,
 * nút chạm ≥44px, tile gọn text-first (đúng retail nhiều mã), màn thành công
 * GỌN + tự qua đơn mới (không bắt bấm), responsive 3 cỡ.
 */

import { useState, useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Prod = { id: string; name: string; code: string; price: number; cat: string; stock: number };

const PRODUCTS: Prod[] = [
  { id: "1", name: "Cà phê sữa đá", code: "CF-001", price: 29000, cat: "Cà phê", stock: 120 },
  { id: "2", name: "Bạc xỉu", code: "CF-002", price: 32000, cat: "Cà phê", stock: 86 },
  { id: "3", name: "Espresso", code: "CF-003", price: 35000, cat: "Cà phê", stock: 40 },
  { id: "4", name: "Cold brew chai 350ml", code: "CF-010", price: 45000, cat: "Cà phê", stock: 22 },
  { id: "5", name: "Cappuccino", code: "CF-004", price: 40000, cat: "Cà phê", stock: 33 },
  { id: "6", name: "Trà đào cam sả", code: "TR-001", price: 39000, cat: "Trà", stock: 64 },
  { id: "7", name: "Trà vải", code: "TR-002", price: 39000, cat: "Trà", stock: 5 },
  { id: "8", name: "Trà sữa trân châu", code: "TR-005", price: 42000, cat: "Trà", stock: 31 },
  { id: "9", name: "Matcha latte", code: "TR-008", price: 45000, cat: "Trà", stock: 28 },
  { id: "10", name: "Coca chai 390ml", code: "NN-001", price: 15000, cat: "Nước ngọt", stock: 200 },
  { id: "11", name: "Bò húc lon", code: "NN-008", price: 18000, cat: "Nước ngọt", stock: 150 },
  { id: "12", name: "Nước suối 500ml", code: "NN-012", price: 10000, cat: "Nước ngọt", stock: 300 },
  { id: "13", name: "Pepsi lon", code: "NN-003", price: 14000, cat: "Nước ngọt", stock: 90 },
  { id: "14", name: "Bánh tiramisu", code: "BN-001", price: 35000, cat: "Bánh", stock: 12 },
  { id: "15", name: "Croissant bơ", code: "BN-004", price: 25000, cat: "Bánh", stock: 8 },
  { id: "16", name: "Bánh mì que", code: "BN-009", price: 12000, cat: "Bánh", stock: 45 },
];

const CATS = ["Tất cả", "Cà phê", "Trà", "Nước ngọt", "Bánh"];
const DENOMS = [50000, 100000, 200000, 500000];
const vnd = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));

type Inv = { id: number; cart: Record<string, number>; customer: string };

export default function PosRetailRealMockup() {
  const [invoices, setInvoices] = useState<Inv[]>([{ id: 1, cart: {}, customer: "Khách lẻ" }]);
  const [activeId, setActiveId] = useState(1);
  const [nextId, setNextId] = useState(2);

  const [cat, setCat] = useState("Tất cả");
  const [query, setQuery] = useState("");
  const [fast, setFast] = useState(false);

  const [orderDiscount, setOrderDiscount] = useState(0);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [vatRate, setVatRate] = useState(0);
  const [method, setMethod] = useState<"cash" | "transfer" | "card" | "mixed">("cash");
  const [paid, setPaid] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [inBill, setInBill] = useState(true);
  const [bump, setBump] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [success, setSuccess] = useState<{ total: number; method: string; change: number } | null>(null);

  const inv = invoices.find((i) => i.id === activeId)!;
  const cart = inv.cart;

  const setCart = (updater: (c: Record<string, number>) => Record<string, number>) =>
    setInvoices((list) => list.map((i) => (i.id === activeId ? { ...i, cart: updater(i.cart) } : i)));

  const add = (id: string) => {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    setBump(id);
    setTimeout(() => setBump(null), 300);
  };
  const dec = (id: string) =>
    setCart((c) => {
      const n = (c[id] ?? 0) - 1;
      const next = { ...c };
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
    });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PRODUCTS.filter(
      (p) =>
        (cat === "Tất cả" || p.cat === cat) &&
        (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)),
    );
  }, [cat, query]);

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ p: PRODUCTS.find((x) => x.id === id)!, qty }))
    .filter((l) => l.p);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const couponAmt = coupon ? Math.round(subtotal * 0.1) : 0;
  const discountAmt = Math.min(subtotal, orderDiscount + couponAmt);
  const afterDiscount = Math.max(0, subtotal - discountAmt);
  const vatAmt = Math.round((afterDiscount * vatRate) / 100);
  const total = afterDiscount + vatAmt;
  const change = Math.max(0, paid - total);
  const debt = Math.max(0, total - paid);

  const resetOrderFields = () => {
    setOrderDiscount(0); setCoupon(null); setCouponInput(""); setVatRate(0);
    setMethod("cash"); setPaid(0); setNote(""); setNoteOpen(false);
  };

  const checkout = () => {
    if (total <= 0) return;
    setSuccess({ total, method: methodLabel(method), change });
    // GỌN: tự qua đơn mới sau 1.4s, KHÔNG bắt bấm (cải tiến tốc độ)
    setTimeout(() => {
      setCart(() => ({}));
      resetOrderFields();
      setShowCart(false);
      setSuccess(null);
    }, 1400);
  };

  const addInvoice = () => {
    setInvoices((list) => [...list, { id: nextId, cart: {}, customer: "Khách lẻ" }]);
    setActiveId(nextId);
    setNextId((n) => n + 1);
    resetOrderFields();
  };

  // ── Bảng giỏ + thanh toán (dùng lại desktop/tablet + tấm điện thoại) ──
  const cartBody = (
    <>
      {/* Khách hàng */}
      <button className="flex items-center justify-between border-b border-border px-3 py-2.5 hover:bg-surface-container-low">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Icon name="person" size={16} className="text-primary" /> {inv.customer}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
          <Icon name="search" size={13} /> Chọn khách <kbd className="rounded bg-surface-container px-1 text-[10px]">F4</kbd>
        </span>
      </button>

      {/* Dòng giỏ */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {lines.length === 0 && (
          <div className="flex h-full min-h-40 flex-col items-center justify-center text-center text-muted-foreground">
            <Icon name="shopping_cart" size={40} className="mb-2 opacity-40" />
            <p className="text-sm">Giỏ trống — chọn món hoặc nhấn F2 tìm/quét mã</p>
          </div>
        )}
        {lines.map((l) => (
          <div key={l.p.id} className="flex items-center gap-2 rounded-lg bg-surface-container-low p-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.p.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{vnd(l.p.price)}đ · {l.p.code}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => dec(l.p.id)} aria-label="Giảm" className="flex size-9 items-center justify-center rounded-full border border-border bg-card transition active:scale-90 hover:bg-surface-container">
                <Icon name="remove" size={15} />
              </button>
              <span className="w-6 text-center text-sm font-bold tabular-nums">{l.qty}</span>
              <button onClick={() => add(l.p.id)} aria-label="Tăng" className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-90 hover:bg-primary-hover">
                <Icon name="add" size={15} />
              </button>
            </div>
            <span className="w-[68px] text-right text-sm font-semibold tabular-nums">{vnd(l.p.price * l.qty)}đ</span>
          </div>
        ))}
      </div>

      {/* Tổng tiền + chiết khấu + VAT */}
      <div className="border-t border-border px-3 py-2 space-y-1.5 bg-surface-container-low/50">
        <Row label={`Tổng tiền hàng (${itemCount} SP)`} value={`${vnd(subtotal)}đ`} />
        <Row label="Giảm giá" value={discountAmt > 0 ? `−${vnd(discountAmt)}đ` : "0"} warn={discountAmt > 0} />
        {!fast && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                Chiết khấu đơn
                <Icon name="vpn_key" size={13} className="text-status-warning" title="Vượt ngưỡng cần OTP quản lý duyệt" />
              </span>
              <div className="inline-flex items-center rounded border border-border bg-card h-7 overflow-hidden">
                <input type="number" inputMode="numeric" value={orderDiscount || ""} onChange={(e) => setOrderDiscount(Math.max(0, parseInt(e.target.value) || 0))} placeholder="0" className="w-20 px-2 text-right text-xs outline-none tabular-nums" />
                <span className="px-2 text-xs text-muted-foreground border-l border-border">đ</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Mã KM</span>
              {coupon ? (
                <span className="inline-flex items-center gap-1 rounded bg-status-success/10 px-2 py-0.5 text-[11px] font-bold text-status-success">
                  <Icon name="check_circle" size={13} /> {coupon} (−10%)
                  <button onClick={() => setCoupon(null)} className="ml-0.5 hover:text-status-error"><Icon name="close" size={12} /></button>
                </span>
              ) : (
                <div className="inline-flex h-7 items-stretch overflow-hidden rounded border border-border bg-card">
                  <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} placeholder="Nhập mã" className="w-20 px-2 text-[11px] uppercase outline-none" />
                  <button onClick={() => { if (couponInput.trim()) setCoupon(couponInput.trim()); }} className="border-l border-border bg-primary px-2.5 text-[11px] font-bold text-primary-foreground hover:bg-primary-hover">Áp</button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">VAT đơn</span>
              <div className="inline-flex items-center gap-1.5">
                <select value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} className="h-7 rounded border border-border bg-card px-1.5 text-[11px] outline-none cursor-pointer">
                  {[0, 5, 8, 10].map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
                {vatRate > 0 && <span className="min-w-[60px] text-right text-[11px] font-medium text-status-warning tabular-nums">+{vnd(vatAmt)}đ</span>}
              </div>
            </div>
          </>
        )}
        {/* Khách cần trả — TO hơn (cải tiến) */}
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-sm font-semibold">Khách cần trả</span>
          <span className="font-heading text-2xl font-extrabold text-primary tabular-nums">{vnd(total)}đ</span>
        </div>
      </div>

      {/* Thanh toán */}
      {!fast && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            {([["cash", "Tiền mặt", "payments"], ["transfer", "CK", "apartment"], ["card", "Thẻ", "credit_card"], ["mixed", "Hỗn hợp", "layers"]] as const).map(([m, label, icon]) => (
              <button key={m} onClick={() => setMethod(m)} className={cn("flex flex-col items-center gap-0.5 rounded-lg py-2 text-[11px] font-semibold transition", method === m ? "bg-primary text-primary-foreground" : "bg-surface-container text-foreground hover:bg-surface-container-high")}>
                <Icon name={icon} size={15} /> {label}
              </button>
            ))}
          </div>
          {method !== "mixed" && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase text-muted-foreground">Khách đưa</span>
                {paid > 0 && change > 0 && <span className="rounded bg-status-success/10 px-2 py-0.5 text-[11px] font-bold text-status-success">Thừa: {vnd(change)}đ</span>}
                {paid > 0 && debt > 0 && <span className="rounded bg-status-warning/10 px-2 py-0.5 text-[11px] font-bold text-status-warning">Nợ: {vnd(debt)}đ</span>}
              </div>
              <input type="number" inputMode="numeric" value={paid || ""} onChange={(e) => setPaid(Math.max(0, parseInt(e.target.value) || 0))} placeholder={`${vnd(total)}`} className={cn("h-10 w-full rounded-lg border px-3 text-right text-base font-bold outline-none tabular-nums", paid >= total && paid > 0 ? "border-status-success/30 bg-status-success/10" : paid > 0 ? "border-status-warning/30 bg-status-warning/10" : "border-border")} />
              <div className="flex gap-1.5">
                {DENOMS.map((d) => (
                  <button key={d} onClick={() => setPaid(d)} className="h-9 flex-1 rounded-lg bg-surface-container-low text-[11px] font-semibold hover:bg-primary-fixed hover:text-primary transition active:scale-95">{d / 1000}k</button>
                ))}
                <button onClick={() => setPaid(total)} className="h-9 flex-1 rounded-lg bg-primary-fixed text-[11px] font-bold text-primary hover:bg-primary-fixed/70 transition active:scale-95">Đủ</button>
              </div>
            </>
          )}
          {method === "mixed" && (
            <div className="rounded-lg bg-surface-container-low p-2 text-center text-[11px] text-muted-foreground">
              Nhập số tiền theo từng hình thức (tiền mặt / CK / thẻ)…
            </div>
          )}
          <div className="flex items-center justify-between">
            <button onClick={() => setNoteOpen(!noteOpen)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <Icon name="expand_more" size={14} className={cn("transition-transform", noteOpen && "rotate-180")} /> Ghi chú
            </button>
            <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={inBill} onChange={() => setInBill(!inBill)} className="size-3.5 rounded border-border" /> In bill
            </label>
          </div>
          {noteOpen && <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ghi chú cho đơn…" className="w-full resize-none rounded-lg border border-border px-3 py-2 text-xs outline-none" />}
        </div>
      )}

      {/* In tạm tính + Nháp + Thanh toán */}
      <div className="border-t border-border p-2.5 space-y-2">
        {lines.length > 0 && (
          <button className="h-8 w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10 inline-flex items-center justify-center gap-1.5">
            <Icon name="receipt_long" size={14} /> In tạm tính
          </button>
        )}
        <div className="flex gap-2">
          <button className="h-12 flex-1 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-surface-container inline-flex items-center justify-center gap-1.5">
            <Icon name="bookmark" size={16} /> Nháp
          </button>
          <button onClick={checkout} disabled={total <= 0} className="h-12 flex-[2] rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-lg transition active:scale-[0.98] hover:bg-primary-hover disabled:opacity-40 inline-flex items-center justify-center gap-2">
            <Icon name="check_circle" size={20} /> Thanh toán
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <style>{`
        @keyframes pop{0%{transform:scale(.7);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
        @keyframes bump{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}
        @keyframes draw{to{stroke-dashoffset:0}}
        @keyframes slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}
        .anim-pop{animation:pop .3s ease-out both}.anim-bump{animation:bump .3s ease-out}.anim-slideup{animation:slideup .25s ease-out}
        .ck-c{stroke-dasharray:166;stroke-dashoffset:166;animation:draw .45s ease-out .05s forwards}
        .ck-t{stroke-dasharray:48;stroke-dashoffset:48;animation:draw .28s ease-out .45s forwards}
      `}</style>

      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 h-14 shrink-0">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-semibold text-primary-foreground shrink-0">
          <Icon name="storefront" size={16} /> <span className="hidden md:inline">Kho Tổng</span>
        </span>
        <span className="hidden lg:inline text-sm font-bold shrink-0">POS Retail</span>
        {/* Ô tìm/quét — to & nổi bật (đường bán nhanh nhất) */}
        <div className="relative flex-1 min-w-0">
          <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên, mã, hoặc quét barcode…" className="h-11 w-full rounded-full border-2 border-primary/30 bg-surface-container-low pl-10 pr-12 text-sm outline-none focus:border-primary" />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-surface-container px-1.5 py-0.5 text-[10px] text-muted-foreground">F2</kbd>
        </div>
        <button onClick={() => setFast(!fast)} className={cn("hidden sm:inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold shrink-0", fast ? "bg-status-warning/15 text-status-warning" : "bg-surface-container text-muted-foreground")}>
          <Icon name="bolt" size={14} /> Bán nhanh
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/10 px-2.5 py-1.5 text-sm font-semibold text-status-success shrink-0">
          <span className="size-2 rounded-full bg-status-success animate-pulse" /> <span className="hidden md:inline">Đang mở ca</span>
        </span>
      </header>

      {/* Tab nhiều đơn */}
      <div className="flex items-center gap-1 border-b border-border bg-surface-container-low px-2 py-1 shrink-0 overflow-x-auto">
        {invoices.map((i, idx) => {
          const c = Object.values(i.cart).reduce((s, q) => s + q, 0);
          return (
            <button key={i.id} onClick={() => setActiveId(i.id)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap", i.id === activeId ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:bg-surface-container")}>
              <Icon name="receipt" size={13} /> Đơn {idx + 1}
              {c > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{c}</span>}
            </button>
          );
        })}
        <button onClick={addInvoice} aria-label="Thêm đơn" className="flex size-7 items-center justify-center rounded-lg text-primary hover:bg-surface-container">
          <Icon name="add" size={18} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Danh mục — sidebar desktop */}
        <aside className="hidden lg:block w-36 shrink-0 border-r border-border bg-card p-2 space-y-1 overflow-y-auto">
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn("w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition", cat === c ? "bg-primary text-primary-foreground" : "hover:bg-surface-container")}>{c}</button>
          ))}
        </aside>

        {/* Lưới sản phẩm — tile gọn text-first (đúng retail nhiều mã) */}
        <main className="flex flex-1 min-w-0 flex-col">
          <div className="lg:hidden flex gap-2 overflow-x-auto border-b border-border bg-card px-3 py-2">
            {CATS.map((c) => (
              <button key={c} onClick={() => setCat(c)} className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-medium transition", cat === c ? "bg-primary text-primary-foreground" : "bg-surface-container text-foreground")}>{c}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 pb-24 md:pb-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-2">
              {shown.map((p) => {
                const inCart = cart[p.id] ?? 0;
                const low = p.stock <= 10;
                return (
                  <button key={p.id} onClick={() => add(p.id)} className="group relative flex items-center gap-2.5 rounded-lg border border-border bg-card p-2 text-left transition active:scale-[0.98] hover:border-primary/40 hover:bg-surface-container-low">
                    {inCart > 0 && <span className={cn("absolute -right-1.5 -top-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground", bump === p.id && "anim-bump")}>{inCart}</span>}
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary-fixed text-lg font-bold text-primary">{p.name.charAt(0)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</p>
                      <div className="mt-0.5 flex items-center justify-between gap-1">
                        <span className="text-sm font-extrabold text-primary tabular-nums">{vnd(p.price)}đ</span>
                        <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", low ? "bg-status-warning/15 text-status-warning" : "bg-surface-container text-muted-foreground")}>{low ? `Sắp hết ${p.stock}` : `Tồn ${p.stock}`}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
              {shown.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">Không tìm thấy sản phẩm phù hợp</p>}
            </div>
          </div>
        </main>

        {/* Giỏ — cột phải tablet + desktop */}
        <aside className="hidden md:flex md:w-[330px] lg:w-[380px] shrink-0 border-l border-border bg-card flex-col">
          {cartBody}
        </aside>
      </div>

      {/* Thanh dưới — điện thoại */}
      <button onClick={() => itemCount > 0 && setShowCart(true)} disabled={itemCount === 0} className="md:hidden flex items-center justify-between gap-3 border-t border-border bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="relative"><Icon name="shopping_cart" size={22} />{itemCount > 0 && <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-card text-[10px] font-bold text-primary">{itemCount}</span>}</span>
          {itemCount > 0 ? `${itemCount} món` : "Chưa có món"}
        </span>
        <span className="flex items-center gap-2 font-bold"><span className="text-lg tabular-nums">{vnd(total)}đ</span><Icon name="arrow_forward" size={18} /></span>
      </button>

      {/* Tấm giỏ điện thoại */}
      {showCart && (
        <div className="md:hidden absolute inset-0 z-40 flex flex-col bg-card anim-slideup">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-base font-bold">Đơn {invoices.findIndex((i) => i.id === activeId) + 1}</span>
            <button onClick={() => setShowCart(false)} aria-label="Đóng" className="flex size-9 items-center justify-center rounded-full hover:bg-surface-container"><Icon name="close" size={20} /></button>
          </div>
          <div className="flex flex-1 flex-col min-h-0">{cartBody}</div>
        </div>
      )}

      {/* Màn thành công — GỌN, tự qua đơn mới (không bắt bấm) */}
      {success && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
          <div className="anim-pop w-full max-w-[300px] rounded-2xl bg-card p-6 text-center ambient-shadow">
            <svg viewBox="0 0 60 60" className="mx-auto mb-3 size-16">
              <circle className="ck-c" cx="30" cy="30" r="26" fill="none" stroke="var(--status-success)" strokeWidth="4" />
              <path className="ck-t" d="M18 31 l8 8 l16 -18" fill="none" stroke="var(--status-success)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2 className="text-lg font-bold">Đã thu {vnd(success.total)}đ</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{success.method}{success.change > 0 ? ` · Thối ${vnd(success.change)}đ` : ""}{inBill ? " · Đang in bill" : ""}</p>
            <p className="mt-3 text-xs text-muted-foreground">Tự chuyển sang đơn mới…</p>
          </div>
        </div>
      )}
    </div>
  );
}

function methodLabel(m: string) {
  return m === "cash" ? "Tiền mặt" : m === "transfer" ? "Chuyển khoản" : m === "card" ? "Thẻ" : "Hỗn hợp";
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <span className={cn("tabular-nums", warn ? "text-status-warning" : "text-foreground font-medium")}>{value}</span>
    </div>
  );
}
