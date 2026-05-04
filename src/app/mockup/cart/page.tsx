"use client";

/**
 * MOCKUP — POS Cart Items Zone redesign comparison
 * Route: /mockup/cart
 *
 * Mục đích: cho CEO xem 3 phương án refactor cột 3 (Cart items) side-by-side
 * trên cùng 1 viewport. Hiển thị data demo (3 SP từ screenshot phản hồi).
 *
 * Sau khi CEO chốt phương án, em sẽ apply thực vào src/app/pos/page.tsx và
 * xoá file mockup này.
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

// ─────────────────────────────────────────
// Demo data — khớp screenshot CEO gửi
// ─────────────────────────────────────────
type LineDemo = {
  id: string;
  index: number;
  name: string;
  code: string;
  qty: number;
  unitPrice: number;
  discountAmount: number;
  total: number;
};

const DEMO_LINES: LineDemo[] = [
  {
    id: "1",
    index: 1,
    name: "Cà phê Phin Truyền Thống Pha Máy 250g",
    code: "SKU-CF001",
    qty: 2,
    unitPrice: 145000,
    discountAmount: 1000,
    total: 280000,
  },
  {
    id: "2",
    index: 2,
    name: "Bột cacao nguyên chất Hà Lan 500g",
    code: "SKU-CC042",
    qty: 1,
    unitPrice: 145000,
    discountAmount: 0,
    total: 145000,
  },
  {
    id: "3",
    index: 3,
    name: "Cốc giấy 16oz có nắp xanh",
    code: "SKU-CG112",
    qty: 1,
    unitPrice: 95000,
    discountAmount: 0,
    total: 95000,
  },
];

export default function MockupCartPage() {
  const [highlighted, setHighlighted] = useState<"current" | "A" | "B" | "C">("A");

  return (
    <div className="min-h-screen bg-surface-container-low p-4 sm:p-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">
            Mockup — POS Cart Items Zone
          </h1>
          <p className="text-sm text-muted-foreground">
            So sánh 4 phương án — width container giả lập <strong>340px</strong> (cart-items-zone laptop 13&quot;).
            Click vào phương án để highlight.
          </p>
        </header>

        {/* Tabs để pick highlight */}
        <div className="flex flex-wrap gap-2 text-xs">
          {(["current", "A", "B", "C"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setHighlighted(k)}
              className={cn(
                "px-3 py-1.5 rounded-full font-medium border transition-colors",
                highlighted === k
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-white text-muted-foreground border-border hover:bg-surface-container",
              )}
            >
              {k === "current"
                ? "Hiện tại (vấn đề)"
                : k === "A"
                  ? "Phương án A — Stack 2-line"
                  : k === "B"
                    ? "Phương án B — Compact gộp ĐG/SL"
                    : "Phương án C — Tăng width"}
            </button>
          ))}
        </div>

        {/* 4 columns side-by-side */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Column
            label="HIỆN TẠI (lỗi)"
            title="Tên SP truncate, header wrap 2 dòng"
            highlighted={highlighted === "current"}
            issue
          >
            <CurrentLayout />
          </Column>

          <Column
            label="PHƯƠNG ÁN A"
            title="Stack 2-line per item"
            note="Tên SP full width. Số liệu rõ. ~52-58px/item, ~10 items/màn."
            highlighted={highlighted === "A"}
            recommended
          >
            <PlanA />
          </Column>

          <Column
            label="PHƯƠNG ÁN B"
            title="Compact gộp ĐG×SL=TT, GG popover"
            note="Dày đặc 14-16 items/màn. Sửa giá phải click row."
            highlighted={highlighted === "B"}
          >
            <PlanB />
          </Column>

          <Column
            label="PHƯƠNG ÁN C"
            title="Tăng width cart-items 360→380, giữ 6-col"
            note="Tên vẫn truncate khi tên dài. Phá tỉ lệ 4-cột."
            highlighted={highlighted === "C"}
          >
            <PlanC />
          </Column>
        </div>

        {/* Footer notes */}
        <footer className="text-xs text-muted-foreground space-y-1 mt-6 border-t pt-4">
          <p><strong>Em recommend phương án A</strong> — tên SP đầy đủ là ưu tiên. CEO chốt → em apply vào pos/page.tsx (xoá mockup).</p>
          <p>Các phương án dùng font/spacing đã giảm chung cho POS (xem ghi chú ở mỗi cột).</p>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Column wrapper
// ─────────────────────────────────────────
function Column({
  label,
  title,
  note,
  highlighted,
  issue,
  recommended,
  children,
}: {
  label: string;
  title: string;
  note?: string;
  highlighted?: boolean;
  issue?: boolean;
  recommended?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-white rounded-lg border-2 transition-all",
        highlighted
          ? "border-primary shadow-lg"
          : issue
            ? "border-status-error/40"
            : recommended
              ? "border-status-success/50"
              : "border-border",
      )}
    >
      <div
        className={cn(
          "px-3 py-2 text-[11px] font-bold tracking-wider uppercase border-b flex items-center gap-2",
          issue
            ? "bg-status-error/10 text-status-error border-status-error/20"
            : recommended
              ? "bg-status-success/10 text-status-success border-status-success/20"
              : "bg-surface-container-low text-muted-foreground",
        )}
      >
        {recommended && <Icon name="recommend" size={12} />}
        {issue && <Icon name="warning" size={12} />}
        {label}
      </div>
      <div className="p-3 space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {note && <p className="text-[11px] text-muted-foreground">{note}</p>}

        {/* Container giả lập cart-items-zone width */}
        <div
          className="border border-dashed border-border/60 bg-white rounded-md overflow-hidden"
          style={{ width: 340, maxWidth: "100%" }}
        >
          {children}
        </div>

        <p className="text-[10px] text-muted-foreground/70 italic mt-1">
          Width container = 340px (cart-items-zone laptop 13&quot;)
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// CURRENT — phá vỡ ngay (đúng như screenshot)
// ─────────────────────────────────────────
function CurrentLayout() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center border-b border-border bg-surface-container-low">
        <div className="flex-1 grid grid-cols-[20px_1fr_66px_44px_60px_66px_18px] gap-0 px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider items-center">
          <span className="text-center">#</span>
          <span>Tên hàng</span>
          <span className="text-right">Đơn giá</span>
          <span className="text-center">SL</span>
          <span className="text-right">Giảm giá</span>
          <span className="text-right">T.Tiền</span>
          <span />
        </div>
      </div>
      {/* Lines */}
      {DEMO_LINES.map((l) => (
        <div
          key={l.id}
          className="flex items-center border-b border-gray-100 hover:bg-surface-container-low/50"
        >
          <div className="flex-1 grid grid-cols-[20px_1fr_66px_44px_60px_66px_18px] gap-0 px-2 py-1.5 items-center text-[11px]">
            <span className="text-center text-muted-foreground tabular-nums">
              {l.index}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{l.name}</p>
              <p className="text-[9px] text-muted-foreground truncate">{l.code}</p>
            </div>
            <span className="text-right tabular-nums">{l.unitPrice}</span>
            <span className="text-center tabular-nums">{l.qty}</span>
            <div className="flex items-center justify-end gap-0.5 text-[10px]">
              <input
                className="w-8 text-right outline-none border border-border rounded px-0.5"
                value={l.discountAmount > 0 ? l.discountAmount : "0"}
                readOnly
              />
              <span className="bg-primary-fixed text-primary px-0.5 rounded">đ</span>
            </div>
            <span className="text-right font-semibold tabular-nums">
              {formatNumber(l.total)}
            </span>
            <button type="button">
              <Icon name="close" size={11} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// PLAN A — Stack 2-line per item
// ─────────────────────────────────────────
function PlanA() {
  return (
    <div>
      {DEMO_LINES.map((l) => (
        <div
          key={l.id}
          className="border-b border-gray-100 hover:bg-surface-container-low/40 group"
        >
          {/* Line 1: # + name + remove */}
          <div className="flex items-start gap-2 px-2.5 pt-1.5">
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-3 mt-0.5 text-right">
              {l.index}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground line-clamp-1 leading-snug">
                {l.name}
              </p>
              <p className="text-[9.5px] text-muted-foreground/80 font-mono">{l.code}</p>
            </div>
            <button
              type="button"
              className="shrink-0 -mt-0.5 p-0.5 text-muted-foreground hover:text-status-error transition-colors opacity-0 group-hover:opacity-100"
            >
              <Icon name="close" size={12} />
            </button>
          </div>

          {/* Line 2: qty stepper × price ─── -GG ─── = total */}
          <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pl-[26px] mt-0.5">
            {/* Qty stepper */}
            <div className="inline-flex items-center bg-surface-container-low rounded h-5 border border-border/40">
              <button className="w-4 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground">
                <Icon name="remove" size={10} />
              </button>
              <span className="w-5 text-center text-[11px] font-medium tabular-nums">
                {l.qty}
              </span>
              <button className="w-4 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground">
                <Icon name="add" size={10} />
              </button>
            </div>
            <span className="text-[10px] text-muted-foreground/60">×</span>
            {/* Price (clickable to edit) */}
            <span className="text-[11px] tabular-nums font-medium hover:text-primary cursor-pointer hover:underline decoration-dotted">
              {formatNumber(l.unitPrice)}
            </span>
            {/* Discount badge — only when > 0 */}
            {l.discountAmount > 0 && (
              <span className="text-[9.5px] font-semibold tabular-nums text-status-warning bg-status-warning/10 px-1 py-0.5 rounded">
                −{formatNumber(l.discountAmount)}đ
              </span>
            )}
            {/* Total — pushed right */}
            <span className="ml-auto text-[12px] font-bold tabular-nums text-primary">
              {formatNumber(l.total)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// PLAN B — Compact gộp "SL × ĐG = TT"
// ─────────────────────────────────────────
function PlanB() {
  return (
    <div>
      {/* Compact header */}
      <div className="grid grid-cols-[18px_1fr_auto_18px] gap-1.5 px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider items-center bg-surface-container-low border-b border-border">
        <span className="text-center">#</span>
        <span>Tên · ĐG × SL</span>
        <span className="text-right">T.Tiền</span>
        <span />
      </div>
      {DEMO_LINES.map((l) => (
        <div
          key={l.id}
          className="grid grid-cols-[18px_1fr_auto_18px] gap-1.5 px-2 py-1.5 items-center border-b border-gray-100 hover:bg-surface-container-low/40 group cursor-pointer"
        >
          <span className="text-[10px] text-muted-foreground tabular-nums text-center">
            {l.index}
          </span>
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-foreground truncate leading-tight">
              {l.name}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums leading-tight">
              {formatNumber(l.unitPrice)} × {l.qty}
              {l.discountAmount > 0 && (
                <span className="ml-1 text-status-warning">
                  · −{formatNumber(l.discountAmount)}đ
                </span>
              )}
            </p>
          </div>
          <span className="text-[12px] font-bold tabular-nums text-primary">
            {formatNumber(l.total)}
          </span>
          <button type="button" className="opacity-0 group-hover:opacity-100">
            <Icon name="close" size={11} className="text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// PLAN C — Tăng width, giữ 6-col
// ─────────────────────────────────────────
function PlanC() {
  return (
    <div>
      {/* Header — same 6 cols nhưng wider distribution */}
      <div className="flex items-center border-b border-border bg-surface-container-low">
        <div className="flex-1 grid grid-cols-[18px_1fr_60px_36px_56px_60px] gap-1 px-2 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider items-center">
          <span className="text-center">#</span>
          <span>Tên hàng</span>
          <span className="text-right">ĐG</span>
          <span className="text-center">SL</span>
          <span className="text-right">GG</span>
          <span className="text-right">TT</span>
        </div>
      </div>
      {/* Lines */}
      {DEMO_LINES.map((l) => (
        <div
          key={l.id}
          className="border-b border-gray-100 hover:bg-surface-container-low/50"
        >
          <div className="flex-1 grid grid-cols-[18px_1fr_60px_36px_56px_60px] gap-1 px-2 py-1.5 items-center text-[11px]">
            <span className="text-center text-muted-foreground tabular-nums">
              {l.index}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{l.name}</p>
              <p className="text-[9px] text-muted-foreground truncate">{l.code}</p>
            </div>
            <span className="text-right tabular-nums">
              {formatNumber(l.unitPrice)}
            </span>
            <span className="text-center tabular-nums">{l.qty}</span>
            <span className="text-right tabular-nums text-status-warning">
              {l.discountAmount > 0 ? `−${formatNumber(l.discountAmount)}` : "0"}
            </span>
            <span className="text-right font-semibold tabular-nums text-primary">
              {formatNumber(l.total)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
