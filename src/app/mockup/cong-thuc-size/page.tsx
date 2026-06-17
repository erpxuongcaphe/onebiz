"use client";

/**
 * MOCKUP — Công thức nguyên liệu theo từng SIZE (FnB)
 * Route: /mockup/cong-thuc-size
 *
 * Mục đích: cho CEO HÌNH DUNG + KIỂM LOGIC trước khi code thật.
 *  - Bên trái: THIẾT KẾ công thức — lưới Nguyên liệu × Size (M/L/XL), mỗi ô
 *    nhập lượng riêng (phi tuyến). Nút "Gợi ý L/XL theo tỉ lệ ly" để nhập nhanh.
 *  - Bên phải: BÁN THỬ (mô phỏng POS) — chọn Size + Mức đường + Mức đá + Topping,
 *    panel "Kho sẽ trừ" tính LIVE để thấy logic trừ kho có đúng không.
 *
 * Quy ước (khớp plan): Size = công thức riêng · Mức đường/đá = nhân hệ số (scale)
 * đúng 1 nguyên liệu · Topping = cộng thêm NVL riêng.
 *
 * Mockup — KHÔNG đụng data thật, chỉ là state trong trình duyệt.
 */

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

type SizeId = "m" | "l" | "xl";
type ScaleBy = "none" | "sugar" | "ice";

interface Ingredient {
  id: string;
  name: string;
  unit: string;
  /** lượng base cho từng size (đường/đá = lượng ở mức 100%) */
  qty: Record<SizeId, number>;
  /** nguyên liệu này bị scale theo modifier nào (none = cố định) */
  scaleBy: ScaleBy;
  /** ly là SKU riêng theo size → hiển thị tên khác nhau */
  perSizeSku?: boolean;
}

interface Topping {
  id: string;
  name: string;
  nvl: string;
  qty: number;
  unit: string;
  price: number;
}

const SIZES: { id: SizeId; label: string; cupMl: number }[] = [
  { id: "m", label: "M", cupMl: 250 },
  { id: "l", label: "L", cupMl: 350 },
  { id: "xl", label: "XL", cupMl: 500 },
];

const SUGAR = [
  { label: "Không", factor: 0 },
  { label: "30%", factor: 0.3 },
  { label: "50%", factor: 0.5 },
  { label: "70%", factor: 0.7 },
  { label: "100%", factor: 1 },
];
const ICE = [
  { label: "Không đá", factor: 0 },
  { label: "Ít", factor: 0.5 },
  { label: "Vừa", factor: 0.75 },
  { label: "Nhiều", factor: 1 },
];

const INITIAL: Ingredient[] = [
  { id: "cafe", name: "Cà phê cốt", unit: "ml", qty: { m: 30, l: 45, xl: 60 }, scaleBy: "none" },
  { id: "sua", name: "Sữa đặc", unit: "ml", qty: { m: 25, l: 30, xl: 35 }, scaleBy: "none" },
  { id: "duong", name: "Đường", unit: "g", qty: { m: 15, l: 20, xl: 25 }, scaleBy: "sugar" },
  { id: "da", name: "Đá viên", unit: "g", qty: { m: 80, l: 120, xl: 150 }, scaleBy: "ice" },
  { id: "ly", name: "Ly nhựa", unit: "cái", qty: { m: 1, l: 1, xl: 1 }, scaleBy: "none", perSizeSku: true },
];

const TOPPINGS: Topping[] = [
  { id: "tc", name: "Trân châu đen", nvl: "NVL Trân châu đen", qty: 30, unit: "g", price: 7000 },
  { id: "pd", name: "Pudding trứng", nvl: "NVL Pudding", qty: 1, unit: "phần", price: 8000 },
];

const PRICE: Record<SizeId, number> = { m: 29000, l: 35000, xl: 42000 };

const round = (n: number) => Math.round(n * 100) / 100;

export default function CongThucTheoSizeMockup() {
  const [rows, setRows] = useState<Ingredient[]>(INITIAL);
  const [size, setSize] = useState<SizeId>("l");
  const [sugarIdx, setSugarIdx] = useState(3); // 70%
  const [iceIdx, setIceIdx] = useState(2); // Vừa
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const setQty = (rowId: string, sz: SizeId, val: number) =>
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, qty: { ...r.qty, [sz]: val } } : r)));

  // Gợi ý L/XL theo tỉ lệ thể tích ly so với M (chỉ nguyên liệu lỏng/đá; ly giữ nguyên)
  const suggestLX = () => {
    const mMl = SIZES[0].cupMl;
    setRows((rs) =>
      rs.map((r) => {
        if (r.perSizeSku) return r; // ly: SKU riêng, không nhân
        const ratioL = SIZES[1].cupMl / mMl;
        const ratioXL = SIZES[2].cupMl / mMl;
        return { ...r, qty: { ...r.qty, l: round(r.qty.m * ratioL), xl: round(r.qty.m * ratioXL) } };
      }),
    );
  };

  const sugarFactor = SUGAR[sugarIdx].factor;
  const iceFactor = ICE[iceIdx].factor;

  // LIVE: kho sẽ trừ khi bán ly hiện chọn
  const deductions = useMemo(() => {
    const base = rows.map((r) => {
      const raw = r.qty[size];
      const factor = r.scaleBy === "sugar" ? sugarFactor : r.scaleBy === "ice" ? iceFactor : 1;
      const name = r.perSizeSku ? `${r.name} ${size.toUpperCase()}` : r.name;
      return {
        id: r.id,
        name,
        unit: r.unit,
        raw,
        factor,
        final: round(raw * factor),
        scaleBy: r.scaleBy,
        kind: "recipe" as const,
      };
    });
    const tops = TOPPINGS.filter((t) => picked.has(t.id)).map((t) => ({
      id: t.id,
      name: t.nvl,
      unit: t.unit,
      raw: t.qty,
      factor: 1,
      final: t.qty,
      scaleBy: "none" as ScaleBy,
      kind: "topping" as const,
    }));
    return [...base, ...tops];
  }, [rows, size, sugarFactor, iceFactor, picked]);

  const total =
    PRICE[size] + TOPPINGS.filter((t) => picked.has(t.id)).reduce((s, t) => s + t.price, 0);

  const togglePick = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <Icon name="tune" size={22} className="text-slate-500" />
            <h1 className="text-xl font-semibold">Công thức theo size — mockup kiểm logic</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Mỗi size một công thức riêng. Đổi size / mức đường / topping ở cột phải để xem kho trừ
            đổi theo từng nguyên liệu — soi logic đúng/sai.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-blue-50 px-2.5 py-1 text-blue-700">
              Size → công thức riêng
            </span>
            <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-700">
              Mức đường / đá → nhân hệ số
            </span>
            <span className="rounded-md bg-amber-50 px-2.5 py-1 text-amber-700">
              Topping → cộng thêm
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
          {/* ───────── TRÁI: Thiết kế công thức ───────── */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="local_cafe" size={20} className="text-amber-700" />
                <span className="font-medium">Cà phê sữa đá — công thức</span>
              </div>
              <button
                onClick={suggestLX}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Icon name="auto_awesome" size={15} />
                Gợi ý L/XL theo tỉ lệ ly
              </button>
            </div>

            {/* Matrix */}
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Nguyên liệu</th>
                    {SIZES.map((s) => (
                      <th key={s.id} className="px-2 py-2 text-center font-medium">
                        {s.label}
                        <span className="ml-1 font-normal text-slate-400">{s.cupMl}ml</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span>{r.name}</span>
                          {r.scaleBy === "sugar" && (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                              theo Mức đường
                            </span>
                          )}
                          {r.scaleBy === "ice" && (
                            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                              theo Mức đá
                            </span>
                          )}
                          {r.perSizeSku && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                              SKU riêng/size
                            </span>
                          )}
                        </div>
                      </td>
                      {SIZES.map((s) => (
                        <td key={s.id} className="px-2 py-1.5 text-center">
                          {r.perSizeSku ? (
                            <span className="text-slate-500">Ly {s.label}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                value={r.qty[s.id]}
                                onChange={(e) => setQty(r.id, s.id, Number(e.target.value) || 0)}
                                className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-right text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                              />
                              <span className="text-[11px] text-slate-400">{r.unit}</span>
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
              <Icon name="lightbulb" size={15} className="mt-0.5 shrink-0 text-amber-500" />
              <span>
                Mỗi nguyên liệu tăng một tỉ lệ khác nhau (cà phê ×2, sữa ×1.4, đá ×1.9, ly đổi SKU) —
                không thể dùng chung 1 hệ số. Đường &amp; đá nhập lượng ở mức 100%, POS tự nhân theo
                lựa chọn của khách.
              </span>
            </p>

            {/* Topping list (setup) */}
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-slate-500">
                Topping (cộng thêm — mỗi món link 1 NVL riêng)
              </div>
              <div className="flex flex-wrap gap-2">
                {TOPPINGS.map((t) => (
                  <span
                    key={t.id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                  >
                    {t.name} · {t.qty}
                    {t.unit} {t.nvl} · {formatCurrency(t.price)}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* ───────── PHẢI: Bán thử (POS) ───────── */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Icon name="point_of_sale" size={20} className="text-blue-700" />
              <span className="font-medium">Bán thử — kiểm kho trừ</span>
            </div>

            {/* Chọn size */}
            <div className="mb-3">
              <div className="mb-1.5 text-xs text-slate-500">Size</div>
              <div className="flex gap-2">
                {SIZES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSize(s.id)}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-sm font-medium",
                      size === s.id
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mức đường */}
            <div className="mb-3">
              <div className="mb-1.5 text-xs text-slate-500">Mức đường</div>
              <div className="flex flex-wrap gap-1.5">
                {SUGAR.map((s, i) => (
                  <button
                    key={s.label}
                    onClick={() => setSugarIdx(i)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                      sugarIdx === i
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mức đá */}
            <div className="mb-3">
              <div className="mb-1.5 text-xs text-slate-500">Mức đá</div>
              <div className="flex flex-wrap gap-1.5">
                {ICE.map((s, i) => (
                  <button
                    key={s.label}
                    onClick={() => setIceIdx(i)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                      iceIdx === i
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Topping */}
            <div className="mb-4">
              <div className="mb-1.5 text-xs text-slate-500">Topping</div>
              <div className="flex flex-wrap gap-1.5">
                {TOPPINGS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => togglePick(t.id)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
                      picked.has(t.id)
                        ? "border-amber-500 bg-amber-50 text-amber-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Kho sẽ trừ — LIVE */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Icon name="inventory_2" size={15} />
                Kho sẽ trừ khi bán ly này
              </div>
              <div className="space-y-1.5">
                {deductions.map((d) => (
                  <div key={d.id + d.kind} className="flex items-center justify-between text-sm">
                    <span className={cn(d.kind === "topping" ? "text-amber-700" : "text-slate-700")}>
                      {d.kind === "topping" && "+ "}
                      {d.name}
                    </span>
                    <span className="font-mono tabular-nums">
                      {d.scaleBy !== "none" ? (
                        <span className="text-slate-400">
                          {d.raw}
                          {d.unit} × {Math.round(d.factor * 100)}% ={" "}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "font-medium",
                          d.scaleBy !== "none"
                            ? "text-emerald-700"
                            : d.kind === "topping"
                              ? "text-amber-700"
                              : "text-slate-900",
                        )}
                      >
                        {d.final}
                        {d.unit}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2">
                <span className="text-sm text-slate-500">Khách trả</span>
                <span className="text-lg font-semibold text-slate-900">{formatCurrency(total)}</span>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-400">
              Đổi Size → cà phê/sữa/đá đổi theo công thức size đó. Đổi Mức đường/đá → chỉ NVL tương
              ứng nhân hệ số. Topping → cộng NVL riêng. Đây đúng là cách RPC sẽ trừ kho.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
