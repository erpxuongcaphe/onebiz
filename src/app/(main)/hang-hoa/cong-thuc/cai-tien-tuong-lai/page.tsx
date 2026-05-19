"use client";

/**
 * Demo trực quan 4 cải tiến tương lai cho BOM picker (CEO 19/05/2026).
 * Chỉ là MOCKUP để CEO duyệt — chưa wire backend.
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DemoMaterial {
  id: string;
  code: string;
  name: string;
  type: "nvl" | "sku";
  category: string;
  unit: string;
  costPrice: number;
  imageUrl?: string;
  usageCount?: number; // số BOM khác đã dùng
  lastUsed?: string;
}

const SAMPLE_MATERIALS: DemoMaterial[] = [
  { id: "1", code: "NVL-CAF-001", name: "Cà phê Robusta sống Đắk Lắk", type: "nvl", category: "Cà phê", unit: "kg", costPrice: 145000, usageCount: 12, lastUsed: "Hôm nay" },
  { id: "2", code: "NVL-CAF-002", name: "Cà phê Arabica sống Cầu Đất", type: "nvl", category: "Cà phê", unit: "kg", costPrice: 280000, usageCount: 8, lastUsed: "2 ngày trước" },
  { id: "3", code: "SKU-CAF-R-001", name: "Cà phê Robusta rang 1kg", type: "sku", category: "Cà phê rang", unit: "kg", costPrice: 220000, usageCount: 18, lastUsed: "Hôm nay" },
  { id: "4", code: "NVL-SUA-001", name: "Sữa đặc Ngôi Sao Phương Nam", type: "nvl", category: "Phụ liệu", unit: "lon", costPrice: 26000, usageCount: 15, lastUsed: "Hôm nay" },
  { id: "5", code: "NVL-SUA-002", name: "Sữa tươi Vinamilk 1L", type: "nvl", category: "Phụ liệu", unit: "lít", costPrice: 32000, usageCount: 14, lastUsed: "Hôm nay" },
  { id: "6", code: "NVL-DUO-001", name: "Đường mía RE Biên Hoà", type: "nvl", category: "Phụ liệu", unit: "kg", costPrice: 24000, usageCount: 22, lastUsed: "Hôm nay" },
  { id: "7", code: "NVL-DUO-002", name: "Đường nâu organic", type: "nvl", category: "Phụ liệu", unit: "kg", costPrice: 58000, usageCount: 4, lastUsed: "3 ngày trước" },
  { id: "8", code: "NVL-LY-001", name: "Ly nhựa 500ml có nắp", type: "nvl", category: "Bao bì", unit: "cái", costPrice: 1200, usageCount: 30, lastUsed: "Hôm nay" },
  { id: "9", code: "NVL-ONG-001", name: "Ống hút giấy 6mm", type: "nvl", category: "Bao bì", unit: "cái", costPrice: 350, usageCount: 28, lastUsed: "Hôm nay" },
  { id: "10", code: "NVL-DAI-001", name: "Đá viên (vận hành nội bộ)", type: "nvl", category: "Phụ liệu", unit: "kg", costPrice: 3000, usageCount: 25, lastUsed: "Hôm nay" },
];

const CATEGORIES = ["Tất cả nhóm", "Cà phê", "Cà phê rang", "Phụ liệu", "Bao bì"];

function MockupSection({
  number,
  title,
  pain,
  benefit,
  effort,
  children,
}: {
  number: number;
  title: string;
  pain: string;
  benefit: string;
  effort: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary font-bold">
            {number}
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="mt-1">
              <span className="text-status-warning font-medium">Vấn đề:</span>{" "}
              {pain}
            </CardDescription>
            <CardDescription className="mt-1">
              <span className="text-status-success font-medium">Lợi ích:</span>{" "}
              {benefit}
            </CardDescription>
            <CardDescription className="mt-1 text-xs">
              <span className="inline-flex items-center gap-1">
                <Icon name="schedule" size={11} />
                Ước lượng: <b>{effort}</b>
              </span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="bg-muted/30 border-t">{children}</CardContent>
    </Card>
  );
}

/** Idea 1: Multi-select picker. */
function MockupMultiSelect() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const filtered = SAMPLE_MATERIALS.filter((m) =>
    !search.trim()
      ? true
      : m.code.toLowerCase().includes(search.toLowerCase()) ||
        m.name.toLowerCase().includes(search.toLowerCase()),
  );

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="bg-background border rounded-lg p-4 max-w-3xl mx-auto">
      <div className="mb-3">
        <h4 className="font-semibold text-base mb-0.5">
          Thêm NVL vào công thức sản xuất (BOM)
        </h4>
        <p className="text-xs text-muted-foreground">
          <b>Multi-select</b> — tick nhiều NVL rồi thêm 1 lần.
        </p>
      </div>

      <div className="relative mb-3">
        <Icon
          name="search"
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo mã hoặc tên SP..."
          className="pl-8"
        />
      </div>

      <div className="text-[11px] text-muted-foreground mb-1.5 flex justify-between">
        <span>
          <b className="text-foreground">{filtered.length}</b> SP phù hợp
        </span>
        {selected.size > 0 && (
          <span className="text-primary">
            Đã tick <b>{selected.size}</b> NVL
          </span>
        )}
      </div>

      <div className="border rounded max-h-72 overflow-y-auto">
        <ul className="divide-y">
          <li className="px-3 py-2 bg-muted/50 sticky top-0 flex items-center gap-3 text-[11px] uppercase text-muted-foreground">
            <Checkbox
              checked={
                filtered.length > 0 &&
                filtered.every((m) => selected.has(m.id))
              }
              onCheckedChange={(v) => {
                if (v) setSelected(new Set(filtered.map((m) => m.id)));
                else setSelected(new Set());
              }}
            />
            <span className="font-mono min-w-[100px]">Mã</span>
            <span className="flex-1">Tên</span>
            <span className="w-20 text-right">Giá vốn</span>
          </li>
          {filtered.map((m) => {
            const isSel = selected.has(m.id);
            return (
              <li
                key={m.id}
                className={`px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors ${
                  isSel ? "bg-primary/10" : "hover:bg-muted/40"
                }`}
                onClick={() => toggle(m.id)}
              >
                <Checkbox checked={isSel} onCheckedChange={() => toggle(m.id)} />
                <span className="font-mono text-[11px] text-muted-foreground min-w-[100px]">
                  {m.code}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {m.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {m.type === "sku" ? "SKU" : "NVL"} · {m.category} · ĐVT{" "}
                    {m.unit}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground w-20 text-right whitespace-nowrap">
                  {m.costPrice.toLocaleString("vi-VN")}đ
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t">
        <Button variant="outline" size="sm">
          Huỷ
        </Button>
        <Button size="sm" disabled={selected.size === 0}>
          <Icon name="add" size={14} className="mr-1" />
          Thêm <b className="mx-1">{selected.size}</b> NVL vào công thức
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 italic">
        💡 Hiện tại CEO phải mở dialog → chọn 1 → "Thêm" → đóng → mở lại → chọn
        cái nữa... <b>8 NVL = 8 vòng lặp</b>. Multi-select rút còn{" "}
        <b>1 lần</b>.
      </p>
    </div>
  );
}

/** Idea 2: Recent / Suggested NVL. */
function MockupSuggested() {
  const [search, setSearch] = useState("");
  const suggested = SAMPLE_MATERIALS.filter((m) => (m.usageCount ?? 0) >= 15)
    .slice(0, 4);
  const all = SAMPLE_MATERIALS;

  return (
    <div className="bg-background border rounded-lg p-4 max-w-3xl mx-auto">
      <div className="mb-3">
        <h4 className="font-semibold text-base mb-0.5">
          Thêm NVL vào công thức sản xuất (BOM)
        </h4>
        <p className="text-xs text-muted-foreground">
          <b>Gợi ý thông minh</b> — NVL dùng nhiều / gần đây hiện đầu tiên.
        </p>
      </div>

      <div className="relative mb-3">
        <Icon
          name="search"
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo mã hoặc tên SP..."
          className="pl-8"
        />
      </div>

      {/* Suggested section */}
      <div className="mb-3 p-3 rounded-md border border-primary/30 bg-primary/5">
        <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-primary">
          <Icon name="auto_awesome" size={14} />
          Gợi ý cho SKU &quot;Cà phê sữa đá&quot;
          <span className="text-[10px] text-muted-foreground font-normal">
            (top NVL dùng nhiều trong cùng nhóm Cà phê pha)
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {suggested.map((m) => (
            <button
              key={m.id}
              type="button"
              className="text-left p-2 rounded border bg-background hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {m.code}
                </span>
                <span className="text-[10px] text-primary">
                  <Icon name="trending_up" size={10} /> Dùng {m.usageCount} BOM
                </span>
              </div>
              <div className="text-sm font-medium truncate">{m.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {m.category} · {m.costPrice.toLocaleString("vi-VN")}đ/{m.unit}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground mb-1.5 px-1">
        Tất cả NVL ({all.length} mục)
      </div>
      <div className="border rounded max-h-48 overflow-y-auto">
        <ul className="divide-y">
          {all.slice(0, 4).map((m) => (
            <li
              key={m.id}
              className="px-3 py-2 flex items-center gap-3 hover:bg-muted/40 cursor-pointer"
            >
              <Icon
                name="radio_button_unchecked"
                size={14}
                className="text-muted-foreground"
              />
              <span className="font-mono text-[11px] text-muted-foreground min-w-[100px]">
                {m.code}
              </span>
              <span className="flex-1 truncate text-sm">{m.name}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 italic">
        💡 Khi tạo SKU &quot;Cà phê sữa đá&quot;, em tự suggest sữa, cà phê,
        đường, đá. CEO bấm 1 nút thay vì tìm từng cái → setup BOM nhanh{" "}
        <b>3x</b>.
      </p>
    </div>
  );
}

/** Idea 3: Thumbnail in list. */
function MockupThumbnail() {
  const [search, setSearch] = useState("");
  return (
    <div className="bg-background border rounded-lg p-4 max-w-3xl mx-auto">
      <div className="mb-3">
        <h4 className="font-semibold text-base mb-0.5">
          Thêm NVL vào công thức sản xuất (BOM)
        </h4>
        <p className="text-xs text-muted-foreground">
          <b>Thumbnail hình ảnh</b> — nhận diện SP bằng mắt thay vì đọc tên.
        </p>
      </div>

      <div className="relative mb-3">
        <Icon
          name="search"
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm..."
          className="pl-8"
        />
      </div>

      <div className="border rounded max-h-72 overflow-y-auto">
        <ul className="divide-y">
          {SAMPLE_MATERIALS.slice(0, 6).map((m) => (
            <li
              key={m.id}
              className="px-3 py-2 flex items-center gap-3 hover:bg-muted/40 cursor-pointer"
            >
              <Icon
                name="radio_button_unchecked"
                size={14}
                className="text-muted-foreground shrink-0"
              />
              {/* Thumbnail mockup — dùng icon thay ảnh thật */}
              <div className="size-10 rounded border bg-muted shrink-0 flex items-center justify-center text-muted-foreground">
                <Icon
                  name={
                    m.category === "Cà phê"
                      ? "coffee"
                      : m.category === "Cà phê rang"
                        ? "local_cafe"
                        : m.category === "Phụ liệu"
                          ? "kitchen"
                          : "inventory_2"
                  }
                  size={20}
                />
              </div>
              <span className="font-mono text-[11px] text-muted-foreground min-w-[100px]">
                {m.code}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate text-sm font-medium">
                  {m.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {m.type === "sku" ? "SKU" : "NVL"} · {m.category} · ĐVT{" "}
                  {m.unit}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {m.costPrice.toLocaleString("vi-VN")}đ
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 italic">
        💡 Quán bận, nhân viên không kịp đọc tên — nhìn hình &quot;ly nhựa
        500ml&quot; vs &quot;ly nhựa 700ml&quot; là phân biệt được ngay. Tiết
        kiệm <b>2s/click</b> + chống nhầm.
      </p>
    </div>
  );
}

/** Idea 4: Empty state with CTA. */
function MockupEmptyStateCTA() {
  return (
    <div className="bg-background border rounded-lg p-4 max-w-3xl mx-auto">
      <div className="mb-3">
        <h4 className="font-semibold text-base mb-0.5">
          Thêm NVL vào công thức sản xuất (BOM)
        </h4>
        <p className="text-xs text-muted-foreground">
          <b>Empty state có CTA</b> — không bí ngõ cụt khi chưa có NVL.
        </p>
      </div>

      <div className="relative mb-3">
        <Icon
          name="search"
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input placeholder="Tìm theo mã hoặc tên SP..." className="pl-8" />
      </div>

      <div className="border rounded p-10 text-center">
        <div className="inline-flex size-14 items-center justify-center rounded-full bg-muted mb-3">
          <Icon name="package_2" size={28} className="text-muted-foreground" />
        </div>
        <h5 className="font-semibold text-sm mb-1">
          Bạn chưa có NVL nào trong hệ thống
        </h5>
        <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto">
          Cần tạo NVL trước (đường, cà phê, sữa...) rồi mới gắn vào công thức
          được. Tạo nhanh không cần đóng dialog này.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button size="sm">
            <Icon name="add" size={14} className="mr-1" />
            Tạo NVL mới ngay
          </Button>
          <Button variant="outline" size="sm">
            <Icon name="upload_file" size={14} className="mr-1" />
            Import từ Excel
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 italic">
        💡 Hiện tại nếu chưa có NVL — dialog rỗng + CEO phải đóng + sang trang
        khác + tạo NVL + quay lại tạo SKU. Empty state có CTA cho phép tạo NVL
        nested ngay trong flow → liền mạch.
      </p>
    </div>
  );
}

/** Bonus idea 5: Drag-drop reorder BOM items. */
function MockupDragDrop() {
  const [items, setItems] = useState([
    { code: "NVL-CAF-001", name: "Cà phê Robusta sống", qty: 0.018, unit: "kg" },
    { code: "NVL-SUA-001", name: "Sữa đặc Ngôi Sao", qty: 30, unit: "ml" },
    { code: "NVL-DUO-001", name: "Đường mía RE", qty: 10, unit: "g" },
    { code: "NVL-DAI-001", name: "Đá viên", qty: 100, unit: "g" },
    { code: "NVL-LY-001", name: "Ly nhựa 500ml", qty: 1, unit: "cái" },
  ]);

  return (
    <div className="bg-background border rounded-lg p-4 max-w-3xl mx-auto">
      <div className="mb-3">
        <h4 className="font-semibold text-base mb-0.5">
          Công thức Cà phê sữa đá
        </h4>
        <p className="text-xs text-muted-foreground">
          <b>Kéo thả</b> để xếp lại thứ tự NVL (chính → phụ → topping).
        </p>
      </div>

      <div className="border rounded">
        <ul className="divide-y">
          {items.map((it, i) => (
            <li
              key={it.code}
              className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40 cursor-grab"
            >
              <Icon
                name="drag_indicator"
                size={16}
                className="text-muted-foreground"
              />
              <span className="text-xs text-muted-foreground w-5">
                {i + 1}.
              </span>
              <span className="font-mono text-[11px] text-muted-foreground min-w-[100px]">
                {it.code}
              </span>
              <span className="flex-1 text-sm">{it.name}</span>
              <span className="text-sm font-medium tabular-nums">
                {it.qty} {it.unit}
              </span>
              <button className="text-muted-foreground hover:text-status-danger">
                <Icon name="delete" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 italic">
        💡 Hiện tại NVL hiện theo thứ tự thêm vào → lộn xộn. Kéo thả cho phép
        sắp xếp logic (chính ở trên, topping ở dưới) → in công thức cho bếp dễ
        đọc + đào tạo nhân viên mới nhanh.
      </p>
    </div>
  );
}

/** Bonus idea 6: Bulk import from Excel/CSV. */
function MockupBulkImport() {
  return (
    <div className="bg-background border rounded-lg p-4 max-w-3xl mx-auto">
      <div className="mb-3">
        <h4 className="font-semibold text-base mb-0.5">
          Import công thức từ Excel
        </h4>
        <p className="text-xs text-muted-foreground">
          <b>Dán dữ liệu</b> từ Excel hoặc upload CSV — setup 50 BOM trong 5
          phút.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <button className="border-2 border-dashed rounded-lg p-4 text-center hover:border-primary hover:bg-primary/5 transition-colors">
          <Icon name="upload_file" size={28} className="text-primary mb-2" />
          <div className="text-sm font-medium">Upload file CSV/Excel</div>
          <div className="text-[10px] text-muted-foreground">.xlsx, .csv</div>
        </button>
        <button className="border-2 border-dashed rounded-lg p-4 text-center hover:border-primary hover:bg-primary/5 transition-colors">
          <Icon name="content_paste" size={28} className="text-primary mb-2" />
          <div className="text-sm font-medium">Dán từ clipboard</div>
          <div className="text-[10px] text-muted-foreground">Ctrl+V</div>
        </button>
      </div>

      <div className="rounded-md bg-muted p-3 font-mono text-[11px] mb-3 overflow-x-auto">
        <div className="text-muted-foreground mb-1.5">
          // Format mẫu (dán từ Excel):
        </div>
        <div>NVL-CAF-001&nbsp;&nbsp;0.018&nbsp;&nbsp;kg&nbsp;&nbsp;5</div>
        <div>NVL-SUA-001&nbsp;&nbsp;30&nbsp;&nbsp;ml&nbsp;&nbsp;2</div>
        <div>NVL-DUO-001&nbsp;&nbsp;10&nbsp;&nbsp;g&nbsp;&nbsp;0</div>
        <div className="text-muted-foreground mt-1.5">
          // Cột: mã | số lượng | đơn vị | % hao hụt
        </div>
      </div>

      <div className="rounded-md border border-status-success/30 bg-status-success/5 p-2 text-xs flex items-center gap-2">
        <Icon name="check_circle" size={14} className="text-status-success" />
        <span>
          <b>3/3</b> dòng hợp lệ — tổng giá vốn dự kiến:{" "}
          <b>4.620đ / 1 ly</b>
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 italic">
        💡 CEO setup 50 SKU FnB → mỗi SKU 5-10 NVL = 300-500 row → click từng
        cái khoảng 1 giờ. Paste từ Excel xong → 5 phút. Cứu thời gian setup
        ban đầu cực kỳ.
      </p>
    </div>
  );
}

export default function BomFutureMockupPage() {
  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      {/* Hero */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center rounded-full bg-status-warning/15 text-status-warning border border-status-warning/30 px-2 py-0.5 text-[10px] font-semibold uppercase">
            Mockup — chưa làm
          </span>
          <span className="text-xs text-muted-foreground">
            CEO duyệt xong em mới ship
          </span>
        </div>
        <h1 className="text-2xl font-bold mb-1">
          6 cải tiến tương lai cho Công thức sản xuất (BOM)
        </h1>
        <p className="text-sm text-muted-foreground">
          Đây là <b>demo trực quan</b> để CEO quyết định cải tiến nào đáng làm
          trước. Mỗi mockup có <b>vấn đề</b> + <b>lợi ích</b> + <b>ước lượng</b>{" "}
          công sức. Em không tự chốt — anh chốt rồi em ship.
        </p>
      </div>

      <div className="space-y-6">
        <MockupSection
          number={1}
          title="Multi-select picker — tick nhiều NVL, thêm 1 lần"
          pain="Mỗi NVL phải mở-chọn-đóng dialog 1 vòng. SKU 'Cà phê sữa đá' có 5-8 NVL → 5-8 vòng lặp = mệt + chậm."
          benefit="1 lần mở dialog → tick 8 NVL → click 'Thêm 8' → xong. Giảm 80% click khi setup BOM."
          effort="0.5 ngày (đổi Select → Checkbox + state Set + handler bulk add)"
        >
          <MockupMultiSelect />
        </MockupSection>

        <MockupSection
          number={2}
          title="Gợi ý NVL thông minh — top-of-list"
          pain="Khi tạo SKU 'Cà phê sữa đá' phải gõ tìm từng cái 'sữa', 'cà phê', 'đường', 'đá'... mặc dù 95% công thức cà phê đều có 4 NVL này."
          benefit="Em phân tích các BOM cùng nhóm → suggest top 4-6 NVL phổ biến nhất ở trên cùng. Bấm 1 nút thay vì gõ tìm."
          effort="1.5 ngày (cần RPC server-side aggregate BOM theo category + frequency)"
        >
          <MockupSuggested />
        </MockupSection>

        <MockupSection
          number={3}
          title="Thumbnail hình ảnh trong list — nhận diện bằng mắt"
          pain="'Ly nhựa 500ml' vs 'Ly nhựa 700ml' vs 'Ly giấy 500ml' nhìn tên dễ nhầm. Quán bận, nhân viên không kịp đọc."
          benefit="Avatar 40x40 ảnh thật mỗi SP → phân biệt bằng mắt 1 cái nhìn → đỡ nhầm + nhanh."
          effort="0.5 ngày (chỉ render `<img>` từ field `imageUrl` có sẵn — nếu trống dùng icon fallback theo nhóm)"
        >
          <MockupThumbnail />
        </MockupSection>

        <MockupSection
          number={4}
          title="Empty state có CTA — không bí ngõ cụt"
          pain="Mở picker, chưa có NVL → list trống + chỉ thấy chữ 'Không tìm thấy'. CEO phải đóng dialog → sang tab khác tạo NVL → quay lại tạo SKU. Mất context."
          benefit="Empty state có 2 nút: 'Tạo NVL mới ngay' (mở dialog NVL nested) + 'Import từ Excel'. Làm xong tự refresh list."
          effort="0.75 ngày (nested dialog + callback re-fetch + handle keyboard escape order)"
        >
          <MockupEmptyStateCTA />
        </MockupSection>

        <MockupSection
          number={5}
          title="Bonus: Kéo thả sắp xếp NVL trong công thức"
          pain="Sau khi thêm 8 NVL, thứ tự lộn xộn theo lúc add. In công thức cho bếp đọc khó hiểu."
          benefit="Kéo thả để sắp: chính → phụ → topping → bao bì. In công thức ra rõ ràng + đào tạo nhân viên mới nhanh."
          effort="1 ngày (cần thư viện dnd-kit + lưu sort_order)"
        >
          <MockupDragDrop />
        </MockupSection>

        <MockupSection
          number={6}
          title="Bonus: Import BOM từ Excel — bulk paste"
          pain="Setup 50 SKU FnB × 5-10 NVL = 300-500 row gõ tay → 1 giờ click chuột mỏi."
          benefit="Copy từ Excel → Paste vào → validate → batch insert. 50 BOM xong trong 5 phút."
          effort="2-3 ngày (cần parser CSV + validate code khớp DB + RPC bulk insert + UI hiển thị lỗi từng dòng)"
        >
          <MockupBulkImport />
        </MockupSection>
      </div>

      {/* Footer summary */}
      <Card className="mt-8 border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Icon name="lightbulb" size={18} className="text-primary" />
            Em đề xuất thứ tự ưu tiên
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>
            <b>🔴 Cao (ROI lớn nhất)</b>: #1 Multi-select (0.5d) + #4 Empty CTA
            (0.75d) — total <b>1.25 ngày</b>, fix pain hằng ngày.
          </div>
          <div>
            <b>🟠 Trung bình</b>: #3 Thumbnail (0.5d) + #2 Suggested (1.5d) —
            polish UX, cần data thực mới phát huy hết.
          </div>
          <div>
            <b>🟡 Sau setup</b>: #6 Bulk import (2-3d) — chỉ giá trị khi setup
            ban đầu. Sau giai đoạn nhập data thì dùng ít.
          </div>
          <div>
            <b>🟢 Polish cuối</b>: #5 Drag-drop (1d) — đẹp nhưng không cấp
            thiết.
          </div>
          <div className="pt-2 border-t mt-3 text-xs text-muted-foreground">
            Tổng nếu làm hết: ~<b>6-7 ngày work</b>. Anh chốt sprint nào em
            khởi động.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
