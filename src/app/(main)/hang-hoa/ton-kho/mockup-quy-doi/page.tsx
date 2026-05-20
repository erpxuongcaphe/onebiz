"use client";

/**
 * Demo trực quan hiển thị quy đổi đơn vị (UOM) trên view tồn kho.
 * CEO 19/05/2026 — v2 sau feedback "chắc chắn có số lẻ, làm gọn nhất,
 * không mất thẩm mỹ list".
 *
 * Phương án Smart Hybrid:
 *   - List row: 1 dòng compact, phép chia có dư (24 hộp · 2 thùng)
 *   - Detail panel: 2 dòng đầy đủ + hệ số
 *   - Stock movement: inline với dấu ngoặc
 *
 * Logic format:
 *   - Số chẵn: "24 hộp · 2 thùng"
 *   - Số lẻ: "25 hộp · 2 thùng 1 lẻ" (Euclidean: floor + remainder)
 *   - Dưới 1 đơn vị lớn: chỉ show "5 hộp" — ẨN quy đổi (chưa đủ 1 thùng)
 */

import { Icon } from "@/components/ui/icon";

interface UomConversion {
  bigUnit: string;
  smallUnit: string;
  factor: number;
}

const CONVERSION: UomConversion = {
  bigUnit: "thùng",
  smallUnit: "hộp",
  factor: 12,
};

/**
 * Format số lượng theo phép chia có dư (Euclidean division).
 * - 24 hộp → "2 thùng"
 * - 25 hộp → "2 thùng 1 lẻ"
 * - 5 hộp → null (chưa đủ 1 thùng, không show quy đổi)
 * - 0 hộp → null
 */
function formatConversion(qty: number, c: UomConversion): string | null {
  if (qty < c.factor) return null;
  const quotient = Math.floor(qty / c.factor);
  const remainder = qty - quotient * c.factor;
  if (remainder === 0) return `${quotient} ${c.bigUnit}`;
  return `${quotient} ${c.bigUnit} ${remainder} lẻ`;
}

/* ─────────────────────────────────────────────────────────── */
/* SAMPLE DATA — bao gồm cả case chẵn lẻ + edge case            */
/* ─────────────────────────────────────────────────────────── */

const PRODUCTS = [
  {
    code: "VPP-HG-A4",
    name: "Hộp giấy A4 Double A",
    quantities: [24, 25, 11, 0, 132, 1, 100],
  },
];

const SAMPLE_QTYS = [
  { qty: 24, label: "Chẵn đúng — 2 thùng" },
  { qty: 25, label: "Lẻ 1 — 2 thùng 1 lẻ" },
  { qty: 31, label: "Lẻ 7 — 2 thùng 7 lẻ" },
  { qty: 11, label: "Chưa đủ 1 thùng — ẩn quy đổi" },
  { qty: 132, label: "Số lớn — 11 thùng" },
];

/* ─────────────────────────────────────────────────────────── */
/* DISPLAY COMPONENTS — phương án Smart Hybrid                  */
/* ─────────────────────────────────────────────────────────── */

/** List row — 1 dòng compact, dấu chấm phân cách */
function StockInline({ qty, unit }: { qty: number; unit: string }) {
  const conv = formatConversion(qty, CONVERSION);
  return (
    <span className="whitespace-nowrap font-semibold">
      {qty} {unit}
      {conv && (
        <span className="text-muted-foreground font-normal">
          {" · "}
          {conv}
        </span>
      )}
    </span>
  );
}

/** Detail panel — 2 dòng có hierarchy + hệ số */
function StockDetail({ qty, unit }: { qty: number; unit: string }) {
  const conv = formatConversion(qty, CONVERSION);
  return (
    <div>
      <div className="text-2xl font-semibold">
        {qty}{" "}
        <span className="text-base font-normal text-muted-foreground">
          {unit}
        </span>
      </div>
      {conv && (
        <div className="text-xs text-muted-foreground mt-0.5">
          = <b className="text-foreground">{conv}</b>{" "}
          <span className="opacity-70">
            (1 {CONVERSION.bigUnit} = {CONVERSION.factor} {CONVERSION.smallUnit})
          </span>
        </div>
      )}
    </div>
  );
}

/** Stock movement — 1 dòng compact với dấu ngoặc */
function StockMovementInline({
  qty,
  unit,
  isInflow,
}: {
  qty: number;
  unit: string;
  isInflow: boolean;
}) {
  const conv = formatConversion(qty, CONVERSION);
  return (
    <span className="font-semibold whitespace-nowrap">
      {isInflow ? "+" : "−"}
      {qty} {unit}
      {conv && (
        <span className="text-muted-foreground font-normal text-xs ml-1">
          ({conv})
        </span>
      )}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* CONTEXT DEMOS                                                 */
/* ─────────────────────────────────────────────────────────── */

function DetailPanelDemo({ qty }: { qty: number }) {
  return (
    <div className="rounded-lg border bg-background shadow-sm p-4 text-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
        Tồn tại chi nhánh này
      </div>
      <StockDetail qty={qty} unit={CONVERSION.smallUnit} />
    </div>
  );
}

function ListRowDemo({ qty, name, code }: { qty: number; name: string; code: string }) {
  return (
    <div className="border-b py-2 px-3 bg-background flex items-center gap-3 text-sm">
      <div className="size-8 rounded bg-muted flex items-center justify-center shrink-0">
        <Icon name="inventory_2" size={16} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{name}</div>
        <div className="text-[10px] text-muted-foreground">{code}</div>
      </div>
      <div className="text-right shrink-0">
        <StockInline qty={qty} unit={CONVERSION.smallUnit} />
      </div>
    </div>
  );
}

function MovementDemo({ qty, isInflow }: { qty: number; isInflow: boolean }) {
  return (
    <div className="rounded-md border bg-background p-3 text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">
          {isInflow ? "Phiếu nhập NH-2026-0421" : "Phiếu xuất XK-2026-0058"}
        </span>
        <span
          className={
            isInflow
              ? "text-xs text-emerald-600"
              : "text-xs text-red-600"
          }
        >
          {isInflow ? "+ Nhập" : "− Xuất"}
        </span>
      </div>
      <div className="font-medium mb-1">Hộp giấy A4 Double A</div>
      <StockMovementInline
        qty={qty}
        unit={CONVERSION.smallUnit}
        isInflow={isInflow}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* PAGE                                                          */
/* ─────────────────────────────────────────────────────────── */

export default function UomDisplayMockupPage() {
  return (
    <div className="container mx-auto py-12 px-6 max-w-6xl">
      {/* Hero */}
      <header className="mb-12">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Mockup quy đổi UOM · v2 (CEO 19/05/2026)
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          Smart Hybrid — gọn + đẹp + xử lý số lẻ đúng
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl leading-relaxed">
          CEO chốt: chắc chắn có số lẻ (vd 25 hộp ÷ 12 = 2.08 thùng) → cần
          format đẹp. Em đổi sang dùng <b className="text-foreground">phép chia
          có dư</b> (Euclidean): 25 hộp ={" "}
          <b className="text-foreground">2 thùng 1 lẻ</b>, không bao giờ render
          số thập phân xấu.
        </p>
      </header>

      {/* Logic giải thích */}
      <section className="mb-12 rounded-2xl border bg-muted/30 p-6">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="functions" size={18} className="text-primary" />
          <h2 className="font-semibold">Logic format</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4 max-w-3xl leading-relaxed">
          Với SP có quy đổi <b className="text-foreground">1 thùng = 12 hộp</b>,
          công thức:{" "}
          <code className="bg-background border px-1.5 py-0.5 rounded text-[11px]">
            quotient = floor(qty / 12), remainder = qty mod 12
          </code>
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {SAMPLE_QTYS.map((s) => (
            <div
              key={s.qty}
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground text-xs">{s.label}</span>
              <span className="font-mono">
                <span className="text-foreground font-semibold">{s.qty}</span>{" "}
                <span className="text-muted-foreground">→</span>{" "}
                <span className="text-primary font-semibold">
                  {formatConversion(s.qty, CONVERSION) ?? (
                    <span className="text-muted-foreground italic">
                      (ẩn quy đổi)
                    </span>
                  )}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Demo Smart Hybrid với 3 context */}
      <section className="space-y-12">
        {/* Detail panel */}
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-2xl font-bold text-muted-foreground">01</span>
            <h2 className="text-2xl font-bold tracking-tight">
              Detail panel — 2 dòng đầy đủ
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
            Khi click row mở slide-over: có space rộng → hiển thị đầy đủ + hệ
            số quy đổi. Pattern Shopify/QuickBooks.
          </p>
          <div className="grid lg:grid-cols-3 gap-4">
            <DetailPanelDemo qty={24} />
            <DetailPanelDemo qty={25} />
            <DetailPanelDemo qty={11} />
          </div>
        </div>

        {/* List row */}
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-2xl font-bold text-muted-foreground">02</span>
            <h2 className="text-2xl font-bold tracking-tight">
              List row — 1 dòng compact
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
            Danh sách SP cần gọn, không tốn chiều cao. Quy đổi đứng cùng dòng
            với số chính, ngăn bằng dấu chấm (·). KHÔNG show khi chưa đủ 1
            thùng (vd 11 hộp).
          </p>
          <div className="rounded-lg border bg-background overflow-hidden max-w-3xl">
            <ListRowDemo
              qty={24}
              name="Hộp giấy A4 Double A"
              code="VPP-HG-A4"
            />
            <ListRowDemo
              qty={25}
              name="Hộp giấy A4 Double A (lô lẻ)"
              code="VPP-HG-A4-L"
            />
            <ListRowDemo
              qty={132}
              name="Hộp giấy A5 Bãi Bằng"
              code="VPP-HG-A5"
            />
            <ListRowDemo
              qty={11}
              name="Hộp giấy A3 Bãi Bằng (chưa đủ thùng)"
              code="VPP-HG-A3"
            />
            <ListRowDemo
              qty={0}
              name="Hộp giấy A2 (hết)"
              code="VPP-HG-A2"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground max-w-3xl">
            ↑ Hàng 4 (11 hộp) + hàng 5 (0 hộp) — em <b>ẩn quy đổi</b> để
            list không noise. Hàng 1 (chẵn) gọn nhất.
          </p>
        </div>

        {/* Movement */}
        <div>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-2xl font-bold text-muted-foreground">03</span>
            <h2 className="text-2xl font-bold tracking-tight">
              Stock movement — inline với dấu ngoặc
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
            Phiếu nhập/xuất hiển thị quy đổi trong dấu ngoặc nhỏ — giúp người
            duyệt phiếu hiểu rõ lượng nhập bao nhiêu thùng.
          </p>
          <div className="grid lg:grid-cols-3 gap-4">
            <MovementDemo qty={24} isInflow={true} />
            <MovementDemo qty={25} isInflow={true} />
            <MovementDemo qty={6} isInflow={false} />
          </div>
        </div>
      </section>

      {/* Side-by-side comparison: trước/sau */}
      <section className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-bold tracking-tight mb-2">
          So sánh trước · sau
        </h2>
        <p className="text-base text-muted-foreground mb-8 max-w-3xl">
          Cùng list 5 SP, trước (chỉ hộp) và sau (smart hybrid).
        </p>
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              Trước · chỉ đơn vị nhỏ
            </div>
            <div className="rounded-lg border bg-background overflow-hidden">
              {[24, 25, 132, 11, 0].map((q, i) => (
                <div
                  key={i}
                  className="border-b py-2 px-3 flex items-center gap-3 text-sm last:border-b-0"
                >
                  <div className="size-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <Icon
                      name="inventory_2"
                      size={16}
                      className="text-muted-foreground"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      Hộp giấy A{i + 2}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      VPP-HG-A{i + 2}
                    </div>
                  </div>
                  <div className="text-right font-semibold shrink-0">
                    {q} hộp
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              Sau · smart hybrid (cùng chiều cao)
            </div>
            <div className="rounded-lg border bg-background overflow-hidden">
              {[24, 25, 132, 11, 0].map((q, i) => (
                <div
                  key={i}
                  className="border-b py-2 px-3 flex items-center gap-3 text-sm last:border-b-0"
                >
                  <div className="size-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <Icon
                      name="inventory_2"
                      size={16}
                      className="text-muted-foreground"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      Hộp giấy A{i + 2}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      VPP-HG-A{i + 2}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <StockInline qty={q} unit="hộp" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground max-w-3xl">
          → Chiều cao row <b>không tăng</b>. Số lẻ format gọn (
          <b className="text-foreground">2 thùng 1 lẻ</b> thay vì{" "}
          <span className="line-through">2.08 thùng</span>). Chưa đủ 1 thùng →{" "}
          <b className="text-foreground">ẩn quy đổi</b>.
        </p>
      </section>

      {/* Decision */}
      <section className="mt-16 border-t pt-12">
        <div className="rounded-2xl border bg-primary/5 border-primary/30 p-8">
          <div className="text-xs uppercase tracking-wider text-primary mb-2">
            Em đề xuất ship phương án này
          </div>
          <h2 className="text-2xl font-bold mb-4">Smart Hybrid</h2>
          <ul className="space-y-2 text-sm mb-6">
            <li className="flex items-baseline gap-2">
              <Icon name="check" size={14} className="text-primary" />
              <span>
                <b>Phép chia có dư</b> (Euclidean) — số lẻ format đẹp:
                &quot;25 hộp · 2 thùng 1 lẻ&quot;
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <Icon name="check" size={14} className="text-primary" />
              <span>
                <b>List row</b> 1 dòng compact — KHÔNG tăng chiều cao, KHÔNG
                mất thẩm mỹ
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <Icon name="check" size={14} className="text-primary" />
              <span>
                <b>Detail panel</b> 2 dòng đầy đủ — có space → show hệ số quy
                đổi
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <Icon name="check" size={14} className="text-primary" />
              <span>
                <b>Ẩn quy đổi</b> khi chưa đủ 1 đơn vị lớn (vd 11 hộp) — list
                sạch
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <Icon name="check" size={14} className="text-primary" />
              <span>
                <b>Reusable helper</b> <code className="text-xs">formatConversion()</code>{" "}
                — wire vào mọi view tồn kho 1 lần
              </span>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Anh OK em ship Phase 1 (detail panel + helper) + Phase 2 (list row +
            stock movements). Tổng ~4 giờ.
          </p>
        </div>
      </section>

      <footer className="text-center text-xs text-muted-foreground mt-16 pb-6">
        Mockup demo · Chưa wire data thật · Sẽ xoá sau khi ship feature
      </footer>
    </div>
  );
}
