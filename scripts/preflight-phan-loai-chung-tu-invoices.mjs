#!/usr/bin/env node
/**
 * READ-ONLY — Phân loại TOÀN BỘ bảng `invoices` theo chứng từ, phục vụ việc
 * tách trang Hóa đơn khỏi Đơn đặt hàng.
 *
 * KHÔNG ghi bất cứ thứ gì: chỉ SELECT. Không UPDATE/INSERT/DELETE/RPC.
 *
 * Mục tiêu: chứng minh bằng dữ liệu thật (không đoán, không lọc mù theo tiền tố
 * "DH") đâu là mốc phân biệt "đơn đặt hàng còn là đơn" với "hóa đơn bán thật".
 *
 * Cơ chế đã đọc từ migration 00169/00203 (`pos_checkout_v3/v5`):
 *   khi HOÀN TẤT, nếu `code` chưa mang tiền tố HD thì cấp mã HD mới và
 *   `order_code := code cũ` (DH/NH). Vì vậy:
 *     · đơn đặt hàng CÒN LÀ ĐƠN  → source='order' và order_code IS NULL
 *     · hóa đơn chuyển TẠI CHỖ  → source='order' và order_code IS NOT NULL
 *   Script này KIỂM CHỨNG mệnh đề đó trên dữ liệu production.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function loadEnv(p) {
  if (!existsSync(p)) return;
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e < 0) continue;
    const k = t.slice(0, e).trim();
    let v = t.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(join(process.cwd(), ".env.local"));
loadEnv(join(process.cwd(), ".env"));

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TRANG = 1000;

/** Đọc HẾT bảng theo trang — không được cắt ở 1000 dòng mặc định của PostgREST. */
async function docHet(cot) {
  const ra = [];
  for (let tu = 0; ; tu += TRANG) {
    const { data, error } = await db
      .from("invoices")
      .select(cot)
      .order("created_at", { ascending: true })
      .range(tu, tu + TRANG - 1);
    if (error) throw new Error(`đọc invoices lỗi: ${error.message}`);
    ra.push(...(data ?? []));
    if (!data || data.length < TRANG) break;
  }
  return ra;
}

const tienTo = (code) => {
  const m = /^([A-Za-z]+)/.exec(code ?? "");
  return m ? m[1].toUpperCase() : "(không chữ)";
};

function phanNhom(r) {
  const laOrder = r.source === "order";
  const coOrderCode = r.order_code != null && r.order_code !== "";
  if (laOrder && !coOrderCode && r.fulfilled_by_id == null) return "A1_DH_goc_CHUA_xu_ly";
  if (laOrder && !coOrderCode && r.fulfilled_by_id != null) return "A2_DH_goc_DA_xu_ly";
  if (laOrder && coOrderCode) return "A3_HD_lich_su_chuyen_TAI_CHO";
  if (r.source_order_id != null) return "B1_HD_con_tu_don_dat_hang";
  if (tienTo(r.code) === "NH") return "B2_nhap_POS_NH";
  return "B3_HD_ban_thang";
}

/** ĐIỀU KIỆN ĐỌC DÙNG CHUNG đang đề xuất — phải khớp hệt bản cài trong code. */
const hienOTrangHoaDon = (r) =>
  r.source !== "order" || (r.order_code != null && r.order_code !== "");

function bang(tieuDe, hang) {
  console.log(`\n=== ${tieuDe} ===`);
  if (hang.length === 0) {
    console.log("  (không có dòng nào)");
    return;
  }
  const cot = Object.keys(hang[0]);
  const rong = cot.map((c) =>
    Math.max(c.length, ...hang.map((h) => String(h[c] ?? "").length)),
  );
  console.log("  " + cot.map((c, i) => c.padEnd(rong[i])).join(" | "));
  console.log("  " + rong.map((w) => "-".repeat(w)).join("-+-"));
  for (const h of hang)
    console.log("  " + cot.map((c, i) => String(h[c] ?? "").padEnd(rong[i])).join(" | "));
}

async function main() {
  const rows = await docHet(
    "id, code, order_code, source, status, source_order_id, fulfilled_by_id, deleted_at, created_at, total",
  );
  console.log(`Tổng số dòng bảng invoices (kể cả xóa mềm): ${rows.length}`);

  const song = rows.filter((r) => r.deleted_at == null);
  console.log(`Trong đó CHƯA xóa mềm: ${song.length}`);

  // ── P1. source × tiền tố mã × có order_code ────────────────────────────────
  const gom = new Map();
  for (const r of song) {
    const k = `${r.source ?? "(null)"}|${tienTo(r.code)}|${r.order_code ? "có" : "không"}`;
    gom.set(k, (gom.get(k) ?? 0) + 1);
  }
  bang(
    "P1. source × tiền tố mã × có order_code (dòng còn sống)",
    [...gom.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => {
        const [source, tien_to, co_order_code] = k.split("|");
        return { source, tien_to, co_order_code, so_dong: v };
      }),
  );

  // ── P2. Phân nhóm chứng từ × status ────────────────────────────────────────
  const gom2 = new Map();
  for (const r of song) {
    const k = `${phanNhom(r)}|${r.status}`;
    gom2.set(k, (gom2.get(k) ?? 0) + 1);
  }
  bang(
    "P2. NHÓM CHỨNG TỪ × status (dòng còn sống)",
    [...gom2.entries()]
      .sort()
      .map(([k, v]) => {
        const [nhom, status] = k.split("|");
        return { nhom, status, so_dong: v };
      }),
  );

  // ── P3. Bất thường — mỗi mục PHẢI = 0, nếu khác thì điều kiện đọc chưa đủ ──
  const batThuong = [
    {
      ma: "X1",
      mo_ta: "code mang tiền tố DH nhưng source KHÁC 'order'",
      loc: (r) => tienTo(r.code) === "DH" && r.source !== "order",
    },
    {
      ma: "X2",
      mo_ta: "source='order' + có order_code nhưng code KHÔNG phải HD",
      loc: (r) => r.source === "order" && r.order_code && tienTo(r.code) !== "HD",
    },
    {
      ma: "X3",
      mo_ta: "source='order' + KHÔNG order_code nhưng code KHÔNG phải DH",
      loc: (r) => r.source === "order" && !r.order_code && tienTo(r.code) !== "DH",
    },
    {
      ma: "X4",
      mo_ta: "source='order' mà lại có source_order_id (đơn cha kiêm con?)",
      loc: (r) => r.source === "order" && r.source_order_id != null,
    },
    {
      ma: "X5",
      mo_ta: "có fulfilled_by_id nhưng source KHÁC 'order'",
      loc: (r) => r.fulfilled_by_id != null && r.source !== "order",
    },
  ];
  bang(
    "P3. KIỂM BẤT THƯỜNG (mọi so_dong phải = 0)",
    batThuong.map((b) => {
      const hit = song.filter(b.loc);
      return {
        ma: b.ma,
        mo_ta: b.mo_ta,
        so_dong: hit.length,
        vi_du: hit.slice(0, 4).map((r) => r.code).join(", "),
      };
    }),
  );

  // ── P4. Ảnh hưởng của điều kiện đọc dùng chung ─────────────────────────────
  const an = song.filter((r) => !hienOTrangHoaDon(r));
  const hien = song.filter(hienOTrangHoaDon);
  bang("P4. ĐIỀU KIỆN ĐỌC DÙNG CHUNG sẽ tác động thế nào", [
    { chi_tieu: "trang Hóa đơn HIỆN NAY hiện (mọi dòng còn sống)", so_dong: song.length },
    { chi_tieu: "sau khi áp điều kiện → CÒN hiện", so_dong: hien.length },
    { chi_tieu: "sau khi áp điều kiện → BỊ ẨN (phải toàn là đơn đặt hàng)", so_dong: an.length },
  ]);

  const anTheoNhom = new Map();
  for (const r of an) anTheoNhom.set(phanNhom(r), (anTheoNhom.get(phanNhom(r)) ?? 0) + 1);
  bang(
    "P4b. Các dòng BỊ ẨN thuộc nhóm nào (chỉ được có A1/A2)",
    [...anTheoNhom.entries()].map(([nhom, so_dong]) => ({ nhom, so_dong })),
  );

  const nhomHien = new Map();
  for (const r of hien) nhomHien.set(phanNhom(r), (nhomHien.get(phanNhom(r)) ?? 0) + 1);
  bang(
    "P4c. Các dòng CÒN HIỆN thuộc nhóm nào (A3 phải còn nguyên)",
    [...nhomHien.entries()].map(([nhom, so_dong]) => ({ nhom, so_dong })),
  );

  // ── P5. Bốn đơn CEO nêu trong ảnh + mẫu mỗi nhóm ───────────────────────────
  const bonDon = song.filter((r) =>
    ["DH000055", "DH000056", "DH000057", "DH000058"].includes(r.code ?? ""),
  );
  bang(
    "P5. Bốn đơn trong ảnh production",
    bonDon.map((r) => ({
      code: r.code,
      source: r.source ?? "(null)",
      order_code: r.order_code ?? "(null)",
      status: r.status,
      fulfilled_by_id: r.fulfilled_by_id ? "có" : "(null)",
      nhom: phanNhom(r),
      con_hien_o_trang_hoa_don: hienOTrangHoaDon(r) ? "CÒN (SAI)" : "ẨN (đúng)",
    })),
  );

  const mau = [];
  for (const nhom of [
    "A1_DH_goc_CHUA_xu_ly",
    "A2_DH_goc_DA_xu_ly",
    "A3_HD_lich_su_chuyen_TAI_CHO",
    "B1_HD_con_tu_don_dat_hang",
    "B2_nhap_POS_NH",
    "B3_HD_ban_thang",
  ]) {
    const ds = song.filter((r) => phanNhom(r) === nhom).slice(0, 3);
    for (const r of ds)
      mau.push({
        nhom,
        code: r.code,
        order_code: r.order_code ?? "(null)",
        source: r.source ?? "(null)",
        status: r.status,
        hien_o_hoa_don: hienOTrangHoaDon(r) ? "có" : "không",
      });
  }
  bang("P6. Mẫu mỗi nhóm", mau);
}

main().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
