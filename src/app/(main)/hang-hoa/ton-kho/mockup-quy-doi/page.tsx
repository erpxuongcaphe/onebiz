"use client";

/**
 * Demo trực quan hiển thị quy đổi đơn vị (UOM) trên view tồn kho.
 * CEO 19/05/2026 — 4 variant × 3 context để chốt phương án.
 * Design philosophy: less chrome, before/after, real Stitch components.
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";

const SAMPLE = {
  productName: "Hộp giấy A4 Double A",
  productCode: "VPP-HG-A4",
  unit: "hộp",
  quantity: 24,
  conversions: [{ from: "thùng", to: "hộp", factor: 12 }],
};

// Compute "24 hộp = 2 thùng" representations
const equivThung = SAMPLE.quantity / 12; // 2

/* ─────────────────────────────────────────────────────────── */
/* VARIANT A — Inline secondary text (recommended)              */
/* ─────────────────────────────────────────────────────────── */
function VariantA_DetailPanel() {
  return (
    <div className="rounded-lg border bg-background shadow-sm p-4 space-y-3 text-sm max-w-md">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Tồn tại chi nhánh này
      </div>
      <div>
        <div className="text-2xl font-semibold">
          {SAMPLE.quantity}{" "}
          <span className="text-base font-normal">{SAMPLE.unit}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          = <b className="text-foreground">{equivThung} thùng</b>{" "}
          <span className="opacity-70">(1 thùng = 12 hộp)</span>
        </div>
      </div>
    </div>
  );
}

function VariantA_ListRow() {
  return (
    <div className="border rounded-md p-3 bg-background flex items-center gap-3 text-sm max-w-md">
      <div className="size-9 rounded bg-muted flex items-center justify-center shrink-0">
        <Icon name="inventory_2" size={18} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{SAMPLE.productName}</div>
        <div className="text-[11px] text-muted-foreground">
          {SAMPLE.productCode}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-semibold">
          {SAMPLE.quantity} {SAMPLE.unit}
        </div>
        <div className="text-[11px] text-muted-foreground">
          = {equivThung} thùng
        </div>
      </div>
    </div>
  );
}

function VariantA_Movement() {
  return (
    <div className="rounded-md border bg-background p-3 max-w-md text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">
          Phiếu nhập NH-2026-0421
        </span>
        <span className="text-xs text-emerald-600">+ Nhập</span>
      </div>
      <div className="font-medium">{SAMPLE.productName}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-semibold text-base">+24 {SAMPLE.unit}</span>
        <span className="text-xs text-muted-foreground">
          (= 2 thùng × 12 hộp)
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* VARIANT B — Inline same line with separator                  */
/* ─────────────────────────────────────────────────────────── */
function VariantB_DetailPanel() {
  return (
    <div className="rounded-lg border bg-background shadow-sm p-4 space-y-3 text-sm max-w-md">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Tồn tại chi nhánh này
      </div>
      <div className="text-2xl font-semibold">
        {SAMPLE.quantity} {SAMPLE.unit}{" "}
        <span className="text-muted-foreground text-base font-normal">
          · {equivThung} thùng
        </span>
      </div>
    </div>
  );
}

function VariantB_ListRow() {
  return (
    <div className="border rounded-md p-3 bg-background flex items-center gap-3 text-sm max-w-md">
      <div className="size-9 rounded bg-muted flex items-center justify-center shrink-0">
        <Icon name="inventory_2" size={18} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{SAMPLE.productName}</div>
        <div className="text-[11px] text-muted-foreground">
          {SAMPLE.productCode}
        </div>
      </div>
      <div className="text-right shrink-0 font-semibold whitespace-nowrap">
        {SAMPLE.quantity} {SAMPLE.unit}{" "}
        <span className="text-muted-foreground font-normal">
          · {equivThung} thùng
        </span>
      </div>
    </div>
  );
}

function VariantB_Movement() {
  return (
    <div className="rounded-md border bg-background p-3 max-w-md text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">
          Phiếu nhập NH-2026-0421
        </span>
        <span className="text-xs text-emerald-600">+ Nhập</span>
      </div>
      <div className="font-medium">{SAMPLE.productName}</div>
      <div className="mt-1 font-semibold">
        +24 {SAMPLE.unit}{" "}
        <span className="text-muted-foreground font-normal">· 2 thùng</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* VARIANT C — Chip badge style                                 */
/* ─────────────────────────────────────────────────────────── */
function VariantC_DetailPanel() {
  return (
    <div className="rounded-lg border bg-background shadow-sm p-4 space-y-3 text-sm max-w-md">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Tồn tại chi nhánh này
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-2xl font-semibold">
          {SAMPLE.quantity} {SAMPLE.unit}
        </span>
        <span className="inline-flex items-center rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[11px] font-medium">
          = {equivThung} thùng
        </span>
      </div>
    </div>
  );
}

function VariantC_ListRow() {
  return (
    <div className="border rounded-md p-3 bg-background flex items-center gap-3 text-sm max-w-md">
      <div className="size-9 rounded bg-muted flex items-center justify-center shrink-0">
        <Icon name="inventory_2" size={18} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{SAMPLE.productName}</div>
        <div className="text-[11px] text-muted-foreground">
          {SAMPLE.productCode}
        </div>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <span className="font-semibold">
          {SAMPLE.quantity} {SAMPLE.unit}
        </span>
        <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px]">
          {equivThung} thùng
        </span>
      </div>
    </div>
  );
}

function VariantC_Movement() {
  return (
    <div className="rounded-md border bg-background p-3 max-w-md text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">
          Phiếu nhập NH-2026-0421
        </span>
        <span className="text-xs text-emerald-600">+ Nhập</span>
      </div>
      <div className="font-medium">{SAMPLE.productName}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-semibold">+24 {SAMPLE.unit}</span>
        <span className="inline-flex items-center rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[10px]">
          = 2 thùng
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* VARIANT D — Hover tooltip with icon                          */
/* ─────────────────────────────────────────────────────────── */
function VariantD_DetailPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-background shadow-sm p-4 space-y-3 text-sm max-w-md">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Tồn tại chi nhánh này
      </div>
      <div className="flex items-baseline gap-1.5 relative">
        <span className="text-2xl font-semibold">
          {SAMPLE.quantity} {SAMPLE.unit}
        </span>
        <button
          type="button"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={() => setOpen((o) => !o)}
          className="text-muted-foreground hover:text-primary"
        >
          <Icon name="info" size={14} />
        </button>
        {open && (
          <div className="absolute left-0 top-9 z-10 rounded-md border bg-popover shadow-md p-2.5 text-xs whitespace-nowrap min-w-[160px]">
            <div className="font-semibold mb-1">Quy đổi đơn vị</div>
            <div className="text-muted-foreground">
              = <b className="text-foreground">2 thùng</b>
              <br />
              <span className="opacity-70">(1 thùng = 12 hộp)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VariantD_ListRow() {
  return (
    <div className="border rounded-md p-3 bg-background flex items-center gap-3 text-sm max-w-md">
      <div className="size-9 rounded bg-muted flex items-center justify-center shrink-0">
        <Icon name="inventory_2" size={18} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{SAMPLE.productName}</div>
        <div className="text-[11px] text-muted-foreground">
          {SAMPLE.productCode}
        </div>
      </div>
      <div className="text-right shrink-0 flex items-center gap-1">
        <span className="font-semibold">
          {SAMPLE.quantity} {SAMPLE.unit}
        </span>
        <Icon
          name="info"
          size={12}
          className="text-muted-foreground cursor-help"
        />
      </div>
    </div>
  );
}

function VariantD_Movement() {
  return (
    <div className="rounded-md border bg-background p-3 max-w-md text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">
          Phiếu nhập NH-2026-0421
        </span>
        <span className="text-xs text-emerald-600">+ Nhập</span>
      </div>
      <div className="font-medium">{SAMPLE.productName}</div>
      <div className="mt-1 flex items-center gap-1">
        <span className="font-semibold">+24 {SAMPLE.unit}</span>
        <Icon
          name="info"
          size={12}
          className="text-muted-foreground cursor-help"
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Layout helpers                                                */
/* ─────────────────────────────────────────────────────────── */

function VariantSection({
  letter,
  title,
  subtitle,
  detailPanel,
  listRow,
  movement,
  pros,
  cons,
  recommended,
}: {
  letter: string;
  title: string;
  subtitle: string;
  detailPanel: React.ReactNode;
  listRow: React.ReactNode;
  movement: React.ReactNode;
  pros: string[];
  cons: string[];
  recommended?: boolean;
}) {
  return (
    <section className="border-t pt-12 pb-4">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-2xl font-bold text-muted-foreground tabular-nums">
          {letter}
        </span>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {recommended && (
          <span className="inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase">
            Em đề xuất
          </span>
        )}
      </div>
      <p className="text-base text-muted-foreground mb-8 max-w-3xl">
        {subtitle}
      </p>

      <div className="grid lg:grid-cols-3 gap-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Detail panel tồn kho
          </div>
          {detailPanel}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            List row (compact)
          </div>
          {listRow}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Stock movement
          </div>
          {movement}
        </div>
      </div>

      <div className="mt-6 grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">
            ✓ Ưu điểm
          </div>
          <ul className="text-sm space-y-1 text-muted-foreground">
            {pros.map((p, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="text-emerald-600 dark:text-emerald-400">+</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold text-status-warning uppercase tracking-wider mb-2">
            ✗ Nhược điểm
          </div>
          <ul className="text-sm space-y-1 text-muted-foreground">
            {cons.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="text-status-warning">−</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function UomDisplayMockupPage() {
  return (
    <div className="container mx-auto py-12 px-6 max-w-6xl">
      {/* Hero */}
      <header className="mb-16">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Mockup hiển thị quy đổi UOM · CEO 19/05/2026
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          4 cách hiển thị &quot;24 hộp = 2 thùng&quot;
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
          Sau khi anh thêm quy đổi <b className="text-foreground">1 thùng = 12 hộp</b>{" "}
          ở tab &quot;ĐVT quy đổi&quot;, các view tồn kho cần hiển thị thế nào?
          Em làm 4 variant trên 3 context (detail panel / list row /
          movement) để anh so sánh.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Icon name="science" size={14} className="text-primary" />
          <span>
            Dữ liệu mẫu: SP{" "}
            <b className="font-mono text-foreground">{SAMPLE.productCode}</b> —{" "}
            <b className="text-foreground">{SAMPLE.productName}</b> · Tồn{" "}
            <b className="text-foreground">
              {SAMPLE.quantity} {SAMPLE.unit}
            </b>{" "}
            · 1 thùng = 12 hộp
          </span>
        </div>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <a href="#a" className="text-primary hover:underline underline-offset-4">
            A · Dòng phụ bên dưới
          </a>
          <span className="text-muted-foreground">·</span>
          <a href="#b" className="text-primary hover:underline underline-offset-4">
            B · Cùng dòng + dấu chấm
          </a>
          <span className="text-muted-foreground">·</span>
          <a href="#c" className="text-primary hover:underline underline-offset-4">
            C · Badge chip
          </a>
          <span className="text-muted-foreground">·</span>
          <a href="#d" className="text-primary hover:underline underline-offset-4">
            D · Icon hover tooltip
          </a>
        </div>
      </header>

      <div id="a">
        <VariantSection
          letter="A"
          title="Dòng phụ bên dưới — secondary text"
          subtitle="Số chính nổi bật, quy đổi ghi nhỏ ở dòng dưới với hệ số. Pattern phổ biến nhất trên các ERP/e-commerce (Shopify, Linear settings)."
          detailPanel={<VariantA_DetailPanel />}
          listRow={<VariantA_ListRow />}
          movement={<VariantA_Movement />}
          pros={[
            "Rõ ràng — không cần hover",
            "Thông tin đầy đủ (hệ số quy đổi)",
            "Hierarchy đúng: số chính > quy đổi",
            "Tablet/mobile vẫn đọc được",
          ]}
          cons={[
            "Chiếm 1 dòng thêm — row list cao hơn ~14px",
            "Detail panel cần ~30px chiều cao thêm",
          ]}
          recommended
        />
      </div>

      <div id="b">
        <VariantSection
          letter="B"
          title="Cùng dòng + dấu chấm phân cách"
          subtitle="Số chính + quy đổi nằm cùng 1 dòng, ngăn bằng dấu chấm (·). Compact nhất, nhưng hệ số quy đổi không hiện."
          detailPanel={<VariantB_DetailPanel />}
          listRow={<VariantB_ListRow />}
          movement={<VariantB_Movement />}
          pros={[
            "Cực kỳ compact — không tốn chiều cao",
            "Quick scan — dễ nhìn nhanh",
            "Tốt cho dense list 100+ SP",
          ]}
          cons={[
            "Mất hệ số quy đổi (1 thùng = 12 hộp)",
            "Khi quy đổi lẻ (vd 25 hộp = 2.08 thùng) → trông xấu",
            "Mobile narrow viewport có thể wrap",
          ]}
        />
      </div>

      <div id="c">
        <VariantSection
          letter="C"
          title="Badge chip — pill style"
          subtitle="Số chính + 1 pill chip nhỏ hiển thị quy đổi. Visually distinct, tách bạch 2 đơn vị."
          detailPanel={<VariantC_DetailPanel />}
          listRow={<VariantC_ListRow />}
          movement={<VariantC_Movement />}
          pros={[
            "Visual distinct — không nhầm với số chính",
            "Có thể click chip để xem detail",
            "Đẹp khi trang ít data (detail panel)",
          ]}
          cons={[
            "Pill chip ở list row chiếm space",
            "Nhiều UI element → cần discipline để không loè",
            "Có thể overkill cho thông tin phụ",
          ]}
        />
      </div>

      <div id="d">
        <VariantSection
          letter="D"
          title="Icon ⓘ hover tooltip"
          subtitle="Số chính sạch sẽ + 1 icon ⓘ nhỏ. Hover/click hiện tooltip với quy đổi. Minimal UI."
          detailPanel={<VariantD_DetailPanel />}
          listRow={<VariantD_ListRow />}
          movement={<VariantD_Movement />}
          pros={[
            "UI cực kỳ sạch — không clutter",
            "Discoverable qua icon",
            "Phù hợp khi quy đổi ít quan trọng",
          ]}
          cons={[
            "Hidden by default — user phải hover/click",
            "Mobile không có hover → cần click → thêm 1 thao tác",
            "Người mới không biết icon là gì",
          ]}
        />
      </div>

      {/* Decision section */}
      <section className="border-t mt-16 pt-12">
        <div className="rounded-2xl border bg-muted/30 p-8">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Em đề xuất
          </div>
          <h2 className="text-2xl font-bold mb-4">
            Variant A · Dòng phụ bên dưới
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-3xl leading-relaxed">
            CEO chính là <b className="text-foreground">đọc nhanh tồn kho</b>{" "}
            chứ không phải <b className="text-foreground">discover thông tin</b>.
            Variant A đáp ứng đúng: số chính nổi bật, quy đổi rõ ràng, không
            cần hover/click. Pattern này dùng phổ biến nhất ở Shopify Inventory,
            QuickBooks, Sage 50.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl bg-background border p-4">
              <div className="text-xs font-semibold text-foreground mb-1">
                Trường hợp dùng A
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>· Detail panel tồn kho</li>
                <li>· Stock movement detail</li>
                <li>· Phiếu nhập/xuất kho</li>
              </ul>
            </div>
            <div className="rounded-xl bg-background border p-4">
              <div className="text-xs font-semibold text-foreground mb-1">
                Trường hợp dùng B (compact)
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>· List row dense (100+ SP)</li>
                <li>· POS product card</li>
                <li>· Báo cáo XNT inline</li>
              </ul>
            </div>
            <div className="rounded-xl bg-background border p-4">
              <div className="text-xs font-semibold text-foreground mb-1">
                Edge case
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>· SP không có quy đổi → ẩn dòng phụ</li>
                <li>· Quy đổi lẻ (25/12) → &quot;2 thùng + 1 hộp lẻ&quot;</li>
                <li>· Nhiều cấp (thùng/lốc/lon) → hiện tất cả</li>
              </ul>
            </div>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Anh chốt variant nào em ship Phase 1 (detail panel) + Phase 2
            (list row + movement). Em đi theo Variant A nếu anh không phản
            biện gì.
          </p>
        </div>
      </section>

      <footer className="text-center text-xs text-muted-foreground mt-16 pb-6">
        Mockup này là demo trực quan · Chưa wire data thật · Sẽ xoá sau khi
        ship feature
      </footer>
    </div>
  );
}
