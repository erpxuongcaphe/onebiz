"use client";

/**
 * MOCKUP xem trước — POS Retail "wow" (CEO 15/06/2026).
 * Trang ĐỘC LẬP, dữ liệu mẫu, KHÔNG đụng POS thật / không gọi service.
 * Mục đích: cho CEO duyệt "gu" cải tiến giao diện + cảm giác bấm trước khi áp.
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Prod = { id: string; name: string; price: number; emoji: string; cat: string; stock: number };

const PRODUCTS: Prod[] = [
  { id: "1", name: "Cà phê sữa đá", price: 29000, emoji: "☕", cat: "Cà phê", stock: 120 },
  { id: "2", name: "Bạc xỉu", price: 32000, emoji: "🥛", cat: "Cà phê", stock: 86 },
  { id: "3", name: "Espresso", price: 35000, emoji: "☕", cat: "Cà phê", stock: 40 },
  { id: "4", name: "Cold brew", price: 45000, emoji: "🧊", cat: "Cà phê", stock: 22 },
  { id: "5", name: "Trà đào cam sả", price: 39000, emoji: "🍑", cat: "Trà", stock: 64 },
  { id: "6", name: "Trà vải", price: 39000, emoji: "🍵", cat: "Trà", stock: 5 },
  { id: "7", name: "Trà sữa trân châu", price: 42000, emoji: "🥤", cat: "Trà", stock: 31 },
  { id: "8", name: "Coca chai", price: 15000, emoji: "🥤", cat: "Nước ngọt", stock: 200 },
  { id: "9", name: "Bò húc", price: 18000, emoji: "⚡", cat: "Nước ngọt", stock: 150 },
  { id: "10", name: "Nước suối", price: 10000, emoji: "💧", cat: "Nước ngọt", stock: 300 },
  { id: "11", name: "Bánh tiramisu", price: 35000, emoji: "🍰", cat: "Bánh", stock: 12 },
  { id: "12", name: "Croissant", price: 25000, emoji: "🥐", cat: "Bánh", stock: 8 },
];

const CATS = ["Tất cả", "Cà phê", "Trà", "Nước ngọt", "Bánh"];
const QUICK = [50000, 100000, 200000, 500000];

const vnd = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + "đ";

export default function PosRetailWowMockup() {
  const [cat, setCat] = useState("Tất cả");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [bump, setBump] = useState<string | null>(null);
  const [pay, setPay] = useState("Tiền mặt");
  const [given, setGiven] = useState(0);
  const [success, setSuccess] = useState(false);

  const shown = PRODUCTS.filter((p) => cat === "Tất cả" || p.cat === cat);
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ p: PRODUCTS.find((x) => x.id === id)!, qty }))
    .filter((l) => l.p);
  const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const change = Math.max(0, given - total);

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

  const checkout = () => {
    if (total <= 0) return;
    setSuccess(true);
  };
  const reset = () => {
    setSuccess(false);
    setCart({});
    setGiven(0);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      <style>{`
        @keyframes pop { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.12)} 100%{transform:scale(1);opacity:1} }
        @keyframes bump { 0%{transform:scale(1)} 40%{transform:scale(1.35)} 100%{transform:scale(1)} }
        @keyframes draw { to { stroke-dashoffset: 0 } }
        .anim-pop{animation:pop .35s ease-out both}
        .anim-bump{animation:bump .3s ease-out}
        .check-circle{stroke-dasharray:166;stroke-dashoffset:166;animation:draw .5s ease-out .1s forwards}
        .check-tick{stroke-dasharray:48;stroke-dashoffset:48;animation:draw .3s ease-out .5s forwards}
      `}</style>

      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 h-14 shrink-0">
        <span className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
          <Icon name="storefront" size={16} /> Quán Cà Phê — Quận 1
        </span>
        <span className="text-sm font-bold tracking-wide">POS Retail</span>
        <div className="relative flex-1 max-w-xl">
          <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <div className="h-10 w-full rounded-full border border-border bg-surface-container-low pl-10 pr-4 flex items-center text-sm text-muted-foreground">
            Tìm sản phẩm theo tên, mã, barcode…
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/10 px-3 py-1.5 text-sm font-semibold text-status-success">
          <span className="size-2 rounded-full bg-status-success animate-pulse" /> Đang mở ca
        </span>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Categories */}
        <aside className="w-40 shrink-0 border-r border-border bg-card p-2 space-y-1">
          {CATS.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all",
                cat === c
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-foreground hover:bg-surface-container",
              )}
            >
              {c}
            </button>
          ))}
        </aside>

        {/* Product grid */}
        <main className="flex-1 min-w-0 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {shown.map((p) => {
              const inCart = cart[p.id] ?? 0;
              const low = p.stock <= 10;
              return (
                <button
                  key={p.id}
                  onClick={() => add(p.id)}
                  className="group relative flex flex-col rounded-xl border border-border bg-card p-3 text-left ambient-shadow transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:scale-[0.97]"
                >
                  {inCart > 0 && (
                    <span
                      className={cn(
                        "absolute -right-2 -top-2 z-10 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow",
                        bump === p.id && "anim-bump",
                      )}
                    >
                      {inCart}
                    </span>
                  )}
                  <div className="mb-2 flex h-20 items-center justify-center rounded-lg bg-primary-fixed text-4xl">
                    {p.emoji}
                  </div>
                  <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight">{p.name}</span>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-base font-extrabold text-primary">{vnd(p.price)}</span>
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                        low ? "bg-status-warning/15 text-status-warning" : "bg-surface-container text-muted-foreground",
                      )}
                    >
                      {low ? `Sắp hết · ${p.stock}` : `Tồn ${p.stock}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </main>

        {/* Cart + payment */}
        <aside className="w-[360px] shrink-0 border-l border-border bg-card flex flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <Icon name="person" size={16} className="text-primary" /> Khách lẻ
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-2.5 py-1 text-xs font-medium">
              <Icon name="shopping_cart" size={13} /> {count} món
            </span>
          </div>

          {/* Lines */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {lines.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                <Icon name="shopping_cart" size={40} className="mb-2 opacity-40" />
                <p className="text-sm">Bấm sản phẩm bên trái để thêm</p>
              </div>
            )}
            {lines.map((l) => (
              <div key={l.p.id} className="flex items-center gap-2 rounded-lg bg-surface-container-low p-2">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary-fixed text-xl">{l.p.emoji}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.p.name}</p>
                  <p className="text-xs text-muted-foreground">{vnd(l.p.price)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => dec(l.p.id)} className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-foreground transition active:scale-90 hover:bg-surface-container">
                    <Icon name="remove" size={15} />
                  </button>
                  <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                  <button onClick={() => add(l.p.id)} className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-90 hover:bg-primary-hover">
                    <Icon name="add" size={15} />
                  </button>
                </div>
                <span className="w-16 text-right text-sm font-semibold">{vnd(l.p.price * l.qty)}</span>
              </div>
            ))}
          </div>

          {/* Payment */}
          <div className="border-t border-border p-4 space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-sm text-muted-foreground">Khách cần trả</span>
              <span className="font-heading text-3xl font-extrabold text-primary leading-none">{vnd(total)}</span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {["Tiền mặt", "CK", "Thẻ", "Hỗn hợp"].map((m) => (
                <button
                  key={m}
                  onClick={() => setPay(m)}
                  className={cn(
                    "rounded-lg py-2 text-xs font-semibold transition",
                    pay === m ? "bg-primary text-primary-foreground" : "bg-surface-container text-foreground hover:bg-surface-container-high",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {QUICK.map((q) => (
                <button key={q} onClick={() => setGiven(q)} className="rounded-lg border border-border bg-card py-1.5 text-xs font-medium hover:bg-surface-container active:scale-95 transition">
                  {q / 1000}k
                </button>
              ))}
            </div>

            {given > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-status-success/10 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Tiền thối</span>
                <span className="font-bold text-status-success">{vnd(change)}</span>
              </div>
            )}

            <button
              onClick={checkout}
              disabled={total <= 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-base font-bold text-primary-foreground shadow-lg transition active:scale-[0.98] hover:bg-primary-hover disabled:opacity-40 disabled:active:scale-100"
            >
              <Icon name="check_circle" size={20} /> Thanh toán {total > 0 && `· ${vnd(total)}`}
            </button>
          </div>
        </aside>
      </div>

      {/* Success overlay */}
      {success && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm">
          <div className="anim-pop w-[340px] rounded-2xl bg-card p-7 text-center ambient-shadow">
            <svg viewBox="0 0 60 60" className="mx-auto mb-4 size-20">
              <circle className="check-circle" cx="30" cy="30" r="26" fill="none" stroke="var(--status-success)" strokeWidth="4" />
              <path className="check-tick" d="M18 31 l8 8 l16 -18" fill="none" stroke="var(--status-success)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2 className="text-xl font-bold">Thanh toán thành công</h2>
            <p className="mt-1 text-sm text-muted-foreground">Đã thu {vnd(total)} · {pay}</p>
            {given > 0 && (
              <p className="mt-3 rounded-lg bg-status-success/10 py-2 text-sm font-semibold text-status-success">
                Tiền thối: {vnd(change)}
              </p>
            )}
            <button onClick={reset} className="mt-5 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground transition active:scale-95 hover:bg-primary-hover">
              Đơn mới
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
