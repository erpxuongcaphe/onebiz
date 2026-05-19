"use client";

/**
 * Demo trực quan cải tiến BOM picker — rewrite v2 (CEO 19/05/2026).
 * Triết lý design: less chrome, more whitespace, 1 idea per section, real
 * "before vs after" comparison. Tham khảo Linear / Stripe / Vercel docs.
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface DemoMaterial {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  costPrice: number;
}

const SAMPLE: DemoMaterial[] = [
  { id: "1", code: "NVL-CAF-001", name: "Cà phê Robusta sống Đắk Lắk", category: "Cà phê", unit: "kg", costPrice: 145000 },
  { id: "2", code: "NVL-SUA-001", name: "Sữa đặc Ngôi Sao", category: "Phụ liệu", unit: "lon", costPrice: 26000 },
  { id: "3", code: "NVL-SUA-002", name: "Sữa tươi Vinamilk 1L", category: "Phụ liệu", unit: "lít", costPrice: 32000 },
  { id: "4", code: "NVL-DUO-001", name: "Đường mía RE Biên Hoà", category: "Phụ liệu", unit: "kg", costPrice: 24000 },
  { id: "5", code: "NVL-LY-001", name: "Ly nhựa 500ml có nắp", category: "Bao bì", unit: "cái", costPrice: 1200 },
  { id: "6", code: "NVL-ONG-001", name: "Ống hút giấy 6mm", category: "Bao bì", unit: "cái", costPrice: 350 },
  { id: "7", code: "NVL-DAI-001", name: "Đá viên", category: "Phụ liệu", unit: "kg", costPrice: 3000 },
];

/* ────────────────────────────────────────────────────────────────────── */
/* Idea 1: Multi-select — chỉ là LIVE mockup, không animate                */
/* ────────────────────────────────────────────────────────────────────── */
function PickerMultiSelect({ checked }: { checked?: Set<string> }) {
  const [sel, setSel] = useState<Set<string>>(checked ?? new Set());

  return (
    <div className="rounded-xl border bg-background shadow-sm overflow-hidden text-sm">
      <div className="px-4 pt-3 pb-2 border-b">
        <div className="font-medium">Thêm NVL vào công thức</div>
      </div>
      <div className="p-3 border-b">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Tìm theo mã hoặc tên..."
            className="pl-8 h-9"
            defaultValue=""
          />
        </div>
      </div>
      <ul className="max-h-[280px] overflow-y-auto divide-y">
        {SAMPLE.map((m) => {
          const isSel = sel.has(m.id);
          return (
            <li
              key={m.id}
              className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer ${
                isSel ? "bg-primary/5" : "hover:bg-muted/40"
              }`}
              onClick={() => {
                const n = new Set(sel);
                if (n.has(m.id)) n.delete(m.id);
                else n.add(m.id);
                setSel(n);
              }}
            >
              <Checkbox checked={isSel} onCheckedChange={() => {}} />
              <span className="flex-1 min-w-0">
                <span className="block truncate">{m.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {m.code} · {m.category}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                {m.costPrice.toLocaleString("vi-VN")}đ/{m.unit}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3 border-t flex items-center justify-between bg-muted/20">
        <span className="text-[11px] text-muted-foreground">
          {sel.size > 0 ? (
            <>
              Đã chọn <b className="text-foreground">{sel.size}</b> NVL
            </>
          ) : (
            "Chưa chọn NVL"
          )}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            Huỷ
          </Button>
          <Button size="sm" disabled={sel.size === 0}>
            Thêm {sel.size > 0 && sel.size} NVL
          </Button>
        </div>
      </div>
    </div>
  );
}

function PickerSingleSelect() {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="rounded-xl border bg-background shadow-sm overflow-hidden text-sm opacity-90">
      <div className="px-4 pt-3 pb-2 border-b">
        <div className="font-medium">Thêm NVL vào công thức</div>
      </div>
      <div className="p-3 border-b">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input placeholder="Tìm..." className="pl-8 h-9" />
        </div>
      </div>
      <ul className="max-h-[280px] overflow-y-auto divide-y">
        {SAMPLE.map((m) => {
          const isSel = sel === m.id;
          return (
            <li
              key={m.id}
              className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer ${
                isSel ? "bg-primary/5" : "hover:bg-muted/40"
              }`}
              onClick={() => setSel(m.id)}
            >
              <Icon
                name={isSel ? "radio_button_checked" : "radio_button_unchecked"}
                size={14}
                className={isSel ? "text-primary" : "text-muted-foreground"}
              />
              <span className="flex-1 min-w-0">
                <span className="block truncate">{m.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {m.code} · {m.category}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                {m.costPrice.toLocaleString("vi-VN")}đ/{m.unit}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3 border-t flex items-center justify-end gap-2 bg-muted/20">
        <Button variant="outline" size="sm">
          Huỷ
        </Button>
        <Button size="sm" disabled={!sel}>
          Thêm
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Idea 2: Empty state CTA                                                 */
/* ────────────────────────────────────────────────────────────────────── */
function PickerEmptyOld() {
  return (
    <div className="rounded-xl border bg-background shadow-sm overflow-hidden text-sm opacity-90">
      <div className="px-4 pt-3 pb-2 border-b">
        <div className="font-medium">Thêm NVL vào công thức</div>
      </div>
      <div className="p-3 border-b">
        <Input placeholder="Tìm..." className="h-9" />
      </div>
      <div className="px-4 py-16 text-center text-xs text-muted-foreground">
        Không tìm thấy SP nào phù hợp filter
      </div>
      <div className="px-4 py-3 border-t flex items-center justify-end gap-2 bg-muted/20">
        <Button variant="outline" size="sm">
          Huỷ
        </Button>
        <Button size="sm" disabled>
          Thêm
        </Button>
      </div>
    </div>
  );
}

function PickerEmptyNew() {
  return (
    <div className="rounded-xl border bg-background shadow-sm overflow-hidden text-sm">
      <div className="px-4 pt-3 pb-2 border-b">
        <div className="font-medium">Thêm NVL vào công thức</div>
      </div>
      <div className="p-3 border-b">
        <Input placeholder="Tìm..." className="h-9" />
      </div>
      <div className="px-4 py-10 text-center">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-muted mb-3">
          <Icon name="package_2" size={24} className="text-muted-foreground" />
        </div>
        <div className="font-medium text-sm mb-1">Chưa có NVL trong hệ thống</div>
        <p className="text-xs text-muted-foreground mb-4 max-w-xs mx-auto">
          Tạo NVL trước rồi mới gắn vào công thức được. Bạn có thể tạo ngay đây
          không cần đóng dialog.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button size="sm">
            <Icon name="add" size={14} className="mr-1" />
            Tạo NVL mới
          </Button>
          <Button variant="outline" size="sm">
            <Icon name="upload_file" size={14} className="mr-1" />
            Import Excel
          </Button>
        </div>
      </div>
      <div className="px-4 py-3 border-t flex items-center justify-end gap-2 bg-muted/20">
        <Button variant="outline" size="sm">
          Đóng
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Idea 3: Bulk import Excel — preview comparison                          */
/* ────────────────────────────────────────────────────────────────────── */
function ImportNew() {
  return (
    <div className="rounded-xl border bg-background shadow-sm overflow-hidden text-sm">
      <div className="px-4 pt-3 pb-2 border-b">
        <div className="font-medium">Nhập công thức từ Excel</div>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button className="rounded-lg border-2 border-dashed py-6 text-center hover:border-primary hover:bg-primary/5 transition">
            <Icon name="upload_file" size={24} className="text-primary mb-1" />
            <div className="text-xs font-medium mt-1">Upload .xlsx / .csv</div>
          </button>
          <button className="rounded-lg border-2 border-dashed py-6 text-center hover:border-primary hover:bg-primary/5 transition">
            <Icon name="content_paste" size={24} className="text-primary mb-1" />
            <div className="text-xs font-medium mt-1">Dán Ctrl+V</div>
          </button>
        </div>

        <div className="rounded-md bg-muted p-3 font-mono text-[11px] mb-3">
          <div className="text-muted-foreground mb-1.5">
            Mẫu (cột Excel | tab):
          </div>
          <div>NVL-CAF-001&nbsp;&nbsp;0.018&nbsp;&nbsp;kg</div>
          <div>NVL-SUA-001&nbsp;&nbsp;30&nbsp;&nbsp;ml</div>
          <div>NVL-DUO-001&nbsp;&nbsp;10&nbsp;&nbsp;g</div>
        </div>

        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs flex items-center gap-2">
          <Icon
            name="check_circle"
            size={14}
            className="text-emerald-500 shrink-0"
          />
          <span>
            <b>3/3</b> dòng hợp lệ — giá vốn:{" "}
            <b className="tabular-nums">4.620đ</b> mỗi ly
          </span>
        </div>
      </div>
      <div className="px-4 py-3 border-t flex items-center justify-end gap-2 bg-muted/20">
        <Button variant="outline" size="sm">
          Huỷ
        </Button>
        <Button size="sm">Thêm 3 NVL vào công thức</Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Layout helpers                                                          */
/* ────────────────────────────────────────────────────────────────────── */
function Section({
  number,
  title,
  subtitle,
  effort,
  impact,
  children,
}: {
  number: string;
  title: string;
  subtitle: string;
  effort: string;
  impact: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t pt-12 pb-4">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-2xl font-bold text-muted-foreground tabular-nums">
          {number}
        </span>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      </div>
      <p className="text-base text-muted-foreground mb-4 max-w-3xl">
        {subtitle}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs mb-8">
        <div>
          <span className="text-muted-foreground">Công sức:</span>{" "}
          <b className="text-foreground">{effort}</b>
        </div>
        <div>
          <span className="text-muted-foreground">Ảnh hưởng:</span>{" "}
          <b className="text-emerald-600 dark:text-emerald-400">{impact}</b>
        </div>
      </div>
      {children}
    </section>
  );
}

function BeforeAfter({
  beforeLabel,
  afterLabel,
  before,
  after,
}: {
  beforeLabel: string;
  afterLabel: string;
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">
      <div>
        <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          {beforeLabel}
        </div>
        {before}
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-primary">
          <span className="size-1.5 rounded-full bg-primary" />
          {afterLabel}
        </div>
        {after}
      </div>
    </div>
  );
}

export default function BomFutureMockupPage() {
  return (
    <div className="container mx-auto py-12 px-6 max-w-6xl">
      {/* Hero */}
      <header className="mb-16">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Đề xuất cải tiến · Mockup v2
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          3 cải tiến đáng làm cho Công thức sản xuất (BOM)
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
          Em rút gọn còn 3 ý tưởng có ROI cao nhất sau khi research các pattern
          của Linear, Stripe và Notion. Mỗi cái có{" "}
          <b className="text-foreground">demo trước/sau</b> để CEO so sánh trực
          quan.
        </p>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <a
            href="#m1"
            className="text-primary hover:underline underline-offset-4"
          >
            01 · Chọn nhiều cùng lúc
          </a>
          <span className="text-muted-foreground">·</span>
          <a
            href="#m2"
            className="text-primary hover:underline underline-offset-4"
          >
            02 · Không bí ngõ cụt
          </a>
          <span className="text-muted-foreground">·</span>
          <a
            href="#m3"
            className="text-primary hover:underline underline-offset-4"
          >
            03 · Nhập từ Excel
          </a>
        </div>
      </header>

      {/* Idea 1 */}
      <div id="m1">
        <Section
          number="01"
          title="Tick nhiều NVL, thêm 1 lần"
          subtitle="Hiện tại mỗi NVL phải mở dialog → chọn → đóng → mở lại. Một SKU như 'Cà phê sữa đá' có 5-8 NVL nghĩa là 5-8 vòng lặp."
          effort="0.5 ngày"
          impact="Giảm 80% số click khi setup BOM"
        >
          <BeforeAfter
            beforeLabel="Trước · Single select"
            afterLabel="Sau · Multi select"
            before={<PickerSingleSelect />}
            after={<PickerMultiSelect checked={new Set(["1", "2", "4", "7"])} />}
          />
          <p className="mt-6 text-sm text-muted-foreground max-w-3xl leading-relaxed">
            <b className="text-foreground">Pattern tham khảo:</b> Notion
            multi-select tags, Linear bulk actions, Gmail multi-row checkbox.
            Mỗi click chỉ thêm 1 state, không reload list. Quen thuộc với mọi
            user.
          </p>
        </Section>
      </div>

      {/* Idea 2 */}
      <div id="m2">
        <Section
          number="02"
          title="Không bí ngõ cụt khi chưa có NVL"
          subtitle="Tenant mới setup chưa có NVL → mở picker thì rỗng. Phải đóng dialog, sang trang khác tạo NVL, rồi quay lại tạo SKU. Mất context và rất dễ bỏ cuộc."
          effort="0.75 ngày"
          impact="Loại bỏ friction cho user mới onboarding"
        >
          <BeforeAfter
            beforeLabel="Trước · Chỉ chữ 'không thấy'"
            afterLabel="Sau · CTA tạo ngay tại chỗ"
            before={<PickerEmptyOld />}
            after={<PickerEmptyNew />}
          />
          <p className="mt-6 text-sm text-muted-foreground max-w-3xl leading-relaxed">
            <b className="text-foreground">Pattern tham khảo:</b> Stripe (empty
            states luôn có CTA), Linear (inline-create thay vì navigate),
            Vercel (preserve user&apos;s flow context). Sau khi tạo xong, list
            tự refresh và highlight NVL vừa tạo.
          </p>
        </Section>
      </div>

      {/* Idea 3 */}
      <div id="m3">
        <Section
          number="03"
          title="Nhập công thức hàng loạt từ Excel"
          subtitle="Setup chuỗi cà phê: 50 SKU × 5-10 NVL = 300-500 dòng. Click thủ công sẽ mất nhiều giờ. Paste từ Excel xuống cách nhanh nhất."
          effort="2-3 ngày"
          impact="Tiết kiệm ~10 giờ setup ban đầu"
        >
          <div className="grid lg:grid-cols-[1fr_2fr] gap-6 lg:gap-8 items-start">
            <div>
              <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground" />
                Bối cảnh thật
              </div>
              <div className="rounded-xl border bg-muted/30 p-5 text-sm leading-relaxed">
                <p className="mb-3">
                  Anh đang có file Excel với 50 SKU và công thức từng SKU.
                </p>
                <p className="mb-3 text-muted-foreground">
                  Nếu click tay từng dòng:
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>· Mở dialog SKU 1 → tab BOM</li>
                  <li>· Click &quot;Thêm NVL&quot; 7 lần</li>
                  <li>· Gõ số lượng 7 ô</li>
                  <li>· Lưu → đóng → mở SKU 2</li>
                  <li className="text-foreground font-medium">
                    · Lặp lại 50 lần ≈ 10 giờ
                  </li>
                </ul>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                Sau · Paste 5 phút
              </div>
              <ImportNew />
            </div>
          </div>
          <p className="mt-6 text-sm text-muted-foreground max-w-3xl leading-relaxed">
            <b className="text-foreground">Pattern tham khảo:</b> Airtable
            paste-from-clipboard, Notion DB import, Linear CSV import. Validate
            từng dòng (mã NVL có tồn tại? số lượng &gt; 0?) — lỗi hiển thị
            inline với link sửa nhanh.
          </p>
        </Section>
      </div>

      {/* Decision section */}
      <section className="border-t mt-16 pt-12">
        <div className="rounded-2xl border bg-muted/30 p-8">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Tóm tắt để CEO quyết định
          </div>
          <h2 className="text-2xl font-bold mb-6">Em đề xuất 2 phase</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-xl bg-background border p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  A
                </span>
                <span className="font-semibold">Quick wins</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  1.25 ngày
                </span>
              </div>
              <ul className="text-sm space-y-1.5 mb-4">
                <li className="flex items-baseline gap-2">
                  <Icon name="check" size={14} className="text-primary" />
                  <span>#01 Multi-select picker</span>
                </li>
                <li className="flex items-baseline gap-2">
                  <Icon name="check" size={14} className="text-primary" />
                  <span>#02 Empty state CTA</span>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Cứu pain hằng ngày của user đã có data. Ship được tuần này.
              </p>
            </div>
            <div className="rounded-xl bg-background border p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold">
                  B
                </span>
                <span className="font-semibold">Setup boost</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  2-3 ngày
                </span>
              </div>
              <ul className="text-sm space-y-1.5 mb-4">
                <li className="flex items-baseline gap-2">
                  <Icon name="check" size={14} className="text-foreground" />
                  <span>#03 Bulk import Excel</span>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Critical khi đang setup data cũ (270 NVL × N công thức). Sau giai
                đoạn setup thì dùng ít.
              </p>
            </div>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Anh chốt phase A trước hay đi cả A + B song song — em ship theo
            quyết định của anh.
          </p>
        </div>
      </section>

      <footer className="text-center text-xs text-muted-foreground mt-16 pb-6">
        Mockup này là demo trực quan · Chưa wire backend · Sẽ xoá sau khi quyết
        định
      </footer>
    </div>
  );
}
