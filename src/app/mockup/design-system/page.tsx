"use client";

/**
 * MOCKUP — Design System Standard
 * Route: /mockup/design-system
 *
 * Sprint VISUAL-1 (CEO 04/05/2026): chuẩn hoá design tokens cho toàn web.
 * CEO confirm scale → em apply systematically vào POS, 9 list pages, ~25
 * dialogs, settings → web cohesive 1 lần là đủ, không refactor lại.
 *
 * 5 scale chuẩn:
 *   1. Typography: 12 / 14 / 16 / 20 / 24 / 32 (6 sizes)
 *   2. Spacing:    4 / 8 / 12 / 16 / 24 / 32  (6 levels)
 *   3. Icon:       14 / 16 / 20 / 24          (4 sizes)
 *   4. Radius:     4 / 8 / 12 / 16 / full     (5 scales)
 *   5. Shadow:     none / sm / md / lg        (4 levels)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export default function DesignSystemMockup() {
  const [activeSection, setActiveSection] = useState<string>("typography");

  return (
    <div className="min-h-screen bg-surface-container-low">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-border px-6 py-4">
        <h1 className="text-2xl font-bold text-foreground">Design System Standard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sprint VISUAL-1 — anh confirm scale này, em apply toàn web
        </p>
      </header>

      <div className="flex">
        {/* Sidebar nav */}
        <aside className="w-56 border-r border-border bg-white sticky top-[73px] h-[calc(100vh-73px)] overflow-y-auto p-4 space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setActiveSection(s.id);
                document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn(
                "w-full text-left px-3 py-2 rounded text-sm transition-colors",
                activeSection === s.id
                  ? "bg-primary-fixed text-primary font-semibold"
                  : "text-muted-foreground hover:bg-surface-container-low hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </aside>

        {/* Content */}
        <main className="flex-1 p-6 max-w-5xl space-y-12">
          <Section1Typography />
          <Section2Spacing />
          <Section3Icons />
          <Section4Radius />
          <Section5Shadow />
          <Section6Colors />
          <Section7Buttons />
          <Section8Inputs />
          <Section9Cards />
          <Section10RealExamples />
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Section navigation
// ─────────────────────────────────────────
const SECTIONS = [
  { id: "typography", label: "1. Typography" },
  { id: "spacing", label: "2. Spacing" },
  { id: "icons", label: "3. Icon sizes" },
  { id: "radius", label: "4. Border radius" },
  { id: "shadow", label: "5. Shadow" },
  { id: "colors", label: "6. Color tokens" },
  { id: "buttons", label: "7. Buttons" },
  { id: "inputs", label: "8. Inputs" },
  { id: "cards", label: "9. Cards" },
  { id: "examples", label: "10. Real examples" },
];

// ─────────────────────────────────────────
// 1. Typography
// ─────────────────────────────────────────
function Section1Typography() {
  return (
    <section id="typography">
      <SectionHeader
        title="1. Typography Scale"
        subtitle="6 sizes — chỉ dùng các giá trị này, KHÔNG dùng [11px], [13px], [15px] nữa"
      />
      <div className="bg-white rounded-lg border border-border divide-y divide-border">
        <TypeRow label="Display" usage="Page titles" className="text-[32px] font-bold leading-tight" sample="Hóa đơn" />
        <TypeRow label="Heading 1" usage="Section titles" className="text-2xl font-bold" sample="Tổng quan" />
        <TypeRow label="Heading 2" usage="Subsection" className="text-xl font-semibold" sample="Sản phẩm" />
        <TypeRow label="Heading 3" usage="Card titles" className="text-base font-semibold" sample="Cà phê Phin Truyền Thống" />
        <TypeRow label="Body" usage="Body text, table cells" className="text-sm" sample="Nội dung text bình thường, dùng nhiều nhất" />
        <TypeRow label="Caption" usage="Labels, hints, meta" className="text-xs text-muted-foreground" sample="Hôm qua · 5 phút trước" />
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Mapping Tailwind: <code className="bg-muted px-1 rounded">text-[32px]</code>,{" "}
        <code className="bg-muted px-1 rounded">text-2xl</code>, <code className="bg-muted px-1 rounded">text-xl</code>,{" "}
        <code className="bg-muted px-1 rounded">text-base</code>, <code className="bg-muted px-1 rounded">text-sm</code>,{" "}
        <code className="bg-muted px-1 rounded">text-xs</code>
      </p>
    </section>
  );
}

function TypeRow({ label, usage, sample, className }: { label: string; usage: string; sample: string; className: string }) {
  return (
    <div className="flex items-center px-4 py-3 gap-4">
      <div className="w-32 shrink-0">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[10px] text-muted-foreground">{usage}</div>
      </div>
      <div className={cn("flex-1", className)}>{sample}</div>
    </div>
  );
}

// ─────────────────────────────────────────
// 2. Spacing
// ─────────────────────────────────────────
function Section2Spacing() {
  const spacings = [
    { value: 4, name: "1", usage: "Tight (badge inner)" },
    { value: 8, name: "2", usage: "Cell padding, gap nhỏ" },
    { value: 12, name: "3", usage: "Input padding, gap form" },
    { value: 16, name: "4", usage: "Section gap, card padding" },
    { value: 24, name: "6", usage: "Page padding mobile" },
    { value: 32, name: "8", usage: "Large section gap, page padding desktop" },
  ];
  return (
    <section id="spacing">
      <SectionHeader
        title="2. Spacing Scale"
        subtitle="6 levels (4 / 8 / 12 / 16 / 24 / 32) — bỏ p-1.5, p-2.5, gap-2.5"
      />
      <div className="bg-white rounded-lg border border-border p-4 space-y-3">
        {spacings.map((s) => (
          <div key={s.value} className="flex items-center gap-4">
            <div className="w-24 shrink-0">
              <div className="text-sm font-semibold">{s.value}px</div>
              <div className="text-xs text-muted-foreground">p-{s.name}</div>
            </div>
            <div className="bg-primary/20" style={{ width: s.value, height: 24 }} />
            <div className="text-sm text-muted-foreground flex-1">{s.usage}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// 3. Icons
// ─────────────────────────────────────────
function Section3Icons() {
  const sizes = [
    { value: 14, usage: "Inline với text-xs/sm (button sm, table row)" },
    { value: 16, usage: "Button md, action menu" },
    { value: 20, usage: "Header icon, page action" },
    { value: 24, usage: "Large action, empty state" },
  ];
  return (
    <section id="icons">
      <SectionHeader
        title="3. Icon Sizes"
        subtitle="4 sizes (14 / 16 / 20 / 24) — bỏ size 10, 11, 12, 13, 18"
      />
      <div className="bg-white rounded-lg border border-border p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {sizes.map((s) => (
          <div key={s.value} className="flex flex-col items-center gap-2 text-center">
            <div className="h-12 flex items-center justify-center bg-surface-container-low rounded-lg w-full">
              <Icon name="shopping_cart" size={s.value} className="text-primary" />
            </div>
            <div className="text-sm font-semibold">{s.value}px</div>
            <div className="text-xs text-muted-foreground">{s.usage}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// 4. Border radius
// ─────────────────────────────────────────
function Section4Radius() {
  const radii = [
    { value: 4, name: "rounded", usage: "Chip, badge nhỏ" },
    { value: 8, name: "rounded-lg", usage: "Input, button, card sm" },
    { value: 12, name: "rounded-xl", usage: "Card md" },
    { value: 16, name: "rounded-2xl", usage: "Card lg, dialog" },
    { value: 9999, name: "rounded-full", usage: "Avatar, pill button, status dot" },
  ];
  return (
    <section id="radius">
      <SectionHeader
        title="4. Border Radius"
        subtitle="5 scales — bỏ rounded-md (6px), rounded-3xl"
      />
      <div className="bg-white rounded-lg border border-border p-4 grid grid-cols-2 sm:grid-cols-5 gap-4">
        {radii.map((r) => (
          <div key={r.name} className="flex flex-col items-center gap-2 text-center">
            <div
              className="w-16 h-16 bg-primary/20 border-2 border-primary"
              style={{ borderRadius: r.value === 9999 ? 9999 : r.value }}
            />
            <div className="text-sm font-semibold">{r.name}</div>
            <div className="text-[10px] text-muted-foreground">{r.usage}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// 5. Shadow
// ─────────────────────────────────────────
function Section5Shadow() {
  return (
    <section id="shadow">
      <SectionHeader title="5. Shadow Levels" subtitle="4 levels — flat, sm, md, lg" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { name: "none", usage: "Flat, no elevation" },
          { name: "shadow-sm", usage: "Subtle (button hover)" },
          { name: "shadow-md", usage: "Card, dropdown" },
          { name: "shadow-lg", usage: "Modal, dialog" },
        ].map((s) => (
          <div key={s.name} className={cn("bg-white rounded-lg p-4 text-center", s.name)}>
            <div className="text-sm font-semibold">{s.name}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.usage}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// 6. Color tokens
// ─────────────────────────────────────────
function Section6Colors() {
  const groups = [
    {
      name: "Primary",
      colors: [
        { name: "primary", desc: "Action chính" },
        { name: "primary-hover", desc: "Hover state" },
        { name: "primary-fixed", desc: "Soft background" },
        { name: "on-primary", desc: "Text on primary" },
      ],
    },
    {
      name: "Surface (5 levels)",
      colors: [
        { name: "surface", desc: "Base bg" },
        { name: "surface-container-lowest", desc: "Lowest" },
        { name: "surface-container-low", desc: "Low (page bg)" },
        { name: "surface-container", desc: "Default container" },
        { name: "surface-container-high", desc: "Elevated" },
        { name: "surface-container-highest", desc: "Highest" },
      ],
    },
    {
      name: "Status",
      colors: [
        { name: "status-success", desc: "OK / hoàn thành" },
        { name: "status-warning", desc: "Cảnh báo / đang xử lý" },
        { name: "status-error", desc: "Lỗi / hủy" },
        { name: "status-info", desc: "Thông tin" },
      ],
    },
  ];
  return (
    <section id="colors">
      <SectionHeader
        title="6. Color Tokens"
        subtitle="CHỈ dùng tokens — bỏ bg-slate-*, bg-blue-*, hex hardcode (theme switching dùng được)"
      />
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.name} className="bg-white rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold mb-3">{g.name}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {g.colors.map((c) => (
                <div key={c.name} className="flex flex-col gap-1">
                  <div className={cn("h-12 rounded-lg border border-border", `bg-${c.name}`)} />
                  <div className="text-xs font-mono">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground">{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// 7. Buttons
// ─────────────────────────────────────────
function Section7Buttons() {
  return (
    <section id="buttons">
      <SectionHeader
        title="7. Button Variants"
        subtitle="4 sizes (xs h-7 / sm h-8 / md h-10 / lg h-12) × 4 variants (default / outline / ghost / destructive)"
      />
      <div className="bg-white rounded-lg border border-border p-4 space-y-4">
        {/* Sizes */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Sizes</div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button className="h-7 px-3 text-xs">xs (h-7)</Button>
            <Button size="sm">sm (h-8)</Button>
            <Button>md (h-10)</Button>
            <Button size="lg">lg (h-12)</Button>
          </div>
        </div>
        {/* Variants */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Variants</div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
        </div>
        {/* With icon */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">With icon</div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button>
              <Icon name="add" size={16} className="mr-1" /> Tạo mới
            </Button>
            <Button variant="outline">
              <Icon name="download" size={16} className="mr-1" /> Xuất Excel
            </Button>
            <Button variant="destructive">
              <Icon name="delete" size={16} className="mr-1" /> Xoá
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// 8. Inputs
// ─────────────────────────────────────────
function Section8Inputs() {
  return (
    <section id="inputs">
      <SectionHeader title="8. Input Variants" subtitle="2 sizes (sm h-8 / md h-10) — bỏ h-9, h-11" />
      <div className="bg-white rounded-lg border border-border p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Sizes</div>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div>
              <label className="text-xs text-muted-foreground">sm (h-8)</label>
              <Input className="h-8" placeholder="Tìm kiếm..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">md (h-10)</label>
              <Input placeholder="Email" />
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">States</div>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <Input placeholder="Default" />
            <Input placeholder="Disabled" disabled />
            <Input placeholder="Error state" className="border-status-error" />
            <Input placeholder="With icon" />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// 9. Cards
// ─────────────────────────────────────────
function Section9Cards() {
  return (
    <section id="cards">
      <SectionHeader title="9. Card Variants" subtitle="3 styles: flat, elevated, outlined" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CardSample variant="flat" />
        <CardSample variant="elevated" />
        <CardSample variant="outlined" />
      </div>
    </section>
  );
}

function CardSample({ variant }: { variant: "flat" | "elevated" | "outlined" }) {
  const styles = {
    flat: "bg-surface-container-low",
    elevated: "bg-white shadow-md",
    outlined: "bg-white border border-border",
  };
  return (
    <div className={cn("rounded-xl p-4", styles[variant])}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {variant}
      </div>
      <h3 className="text-base font-semibold">Cà phê Phin Truyền Thống</h3>
      <p className="text-sm text-muted-foreground mt-1">SKU-RXA-001 · Túi 250g</p>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <span className="text-xs text-muted-foreground">Tồn kho: 24</span>
        <span className="text-base font-bold text-primary">145,000đ</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// 10. Real examples
// ─────────────────────────────────────────
function Section10RealExamples() {
  return (
    <section id="examples">
      <SectionHeader title="10. Real component examples" subtitle="Mẫu component phối hợp tất cả scale chuẩn" />
      <div className="space-y-4">
        {/* Page header sample */}
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
            Page Header
          </div>
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-border">
            <div>
              <h2 className="text-2xl font-bold">Hoá đơn</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Quản lý hoá đơn bán hàng · 245 đơn
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Icon name="download" size={16} className="mr-1" /> Xuất Excel
              </Button>
              <Button>
                <Icon name="add" size={16} className="mr-1" /> Tạo mới
              </Button>
            </div>
          </div>
        </div>

        {/* KPI row sample */}
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
            KPI Summary Row
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Số HĐ", value: "245", color: "" },
              { label: "Tổng tiền", value: "1,245,000đ", color: "" },
              { label: "Đã thu", value: "980,000đ", color: "text-status-success" },
              { label: "Còn nợ", value: "265,000đ", color: "text-status-warning" },
            ].map((k) => (
              <div key={k.label} className="bg-surface-container-low rounded-lg p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">{k.label}</div>
                <div className={cn("text-xl font-bold tabular-nums mt-1", k.color)}>{k.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Table row sample */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="text-xs font-semibold text-muted-foreground p-3 uppercase tracking-wider border-b border-border">
            Table Row
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low border-b border-border">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider">Mã HĐ</th>
                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider">Khách hàng</th>
                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider">Tổng</th>
                <th className="text-center px-4 py-2 text-xs font-semibold uppercase tracking-wider">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-container-low/50">
                  <td className="px-4 py-3 font-mono text-sm">HD00012{i}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium">Bùi Thị Hồng</div>
                    <div className="text-xs text-muted-foreground">KH021</div>
                  </td>
                  <td className="text-right px-4 py-3 font-semibold tabular-nums">{(450000 * i).toLocaleString("en-US")}đ</td>
                  <td className="text-center px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-status-success/15 text-status-success">
                      Hoàn thành
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Form sample */}
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
            Form Section
          </div>
          <h3 className="text-base font-semibold mb-3">Thông tin khách hàng</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1 block">Tên khách hàng</label>
              <Input placeholder="Bùi Thị Hồng" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Số điện thoại</label>
              <Input placeholder="0901111118" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium mb-1 block">Địa chỉ</label>
              <Input placeholder="90 Nguyễn Văn Cừ, Q5" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
            <Button variant="outline">Huỷ</Button>
            <Button>Lưu</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────
// Helper
// ─────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}
