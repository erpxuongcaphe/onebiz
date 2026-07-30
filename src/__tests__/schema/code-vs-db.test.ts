/**
 * Code có gọi đúng những gì database THẬT SỰ có không?
 *
 * Loại lỗi này là nguyên nhân số một làm "nút bấm không ăn": code đọc/ghi một
 * cột hoặc gọi một hàm không tồn tại → PostgREST trả 42703/404, cả màn hình
 * trắng hoặc dữ liệu không lưu, mà TypeScript KHÔNG bắt được vì phần lớn query
 * đi qua `as any`.
 *
 * Đã bắt được 6 lỗi thật khi dựng test này (29/07/2026):
 *   cash_transactions.date            → đúng: transaction_date   (cron cuối ngày)
 *   online_orders.branch_id           → không có cột             (báo cáo kênh)
 *   kitchen_orders.customer_name      → không có cột             (báo cáo shipper)
 *   invoices.platform_commission_amount → đúng: platform_commission (in lại bill F&B)
 *   invoice_items.created_at          → không có cột             (in lại bill F&B)
 *   kitchen_order_items.created_at    → không có cột             (chia bill)
 *
 * Nguồn sự thật: src/__tests__/schema/db-schema.json — ảnh chụp từ database
 * thật. Chạy migration đổi cột thì cập nhật lại bằng:
 *     node scripts/dump-db-schema.mjs
 *
 * ⚠️ Giới hạn đã biết (chấp nhận để KHÔNG báo oan):
 *   • cột trong quan hệ lồng `rel(a, b)` không kiểm (thuộc bảng khác)
 *   • khoá trong object lồng không kiểm (là JSONB, không phải cột)
 *   • query gán qua biến chỉ kiểm khi tên biến gắn với đúng MỘT bảng
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import schema from "./db-schema.json";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

const COT = new Map<string, Set<string>>(
  Object.entries(schema.bang as Record<string, string[]>).map(([t, c]) => [t, new Set(c)]),
);
const RPC = new Set(schema.rpc as string[]);

/** Bỏ ghi chú, giữ nguyên độ dài để số dòng không lệch. */
function xoaGhiChu(s: string): string {
  let r = "";
  let i = 0;
  let trong: string | null = null;
  let nhay = "";
  while (i < s.length) {
    const c = s[i];
    const c2 = s[i + 1];
    if (trong === "//") {
      if (c === "\n") { trong = null; r += c; } else r += " ";
      i++; continue;
    }
    if (trong === "/*") {
      if (c === "*" && c2 === "/") { trong = null; r += "  "; i += 2; }
      else { r += c === "\n" ? c : " "; i++; }
      continue;
    }
    if (trong === "str") {
      r += c;
      if (c === "\\") { r += s[i + 1] ?? ""; i += 2; continue; }
      if (c === nhay) trong = null;
      i++; continue;
    }
    if (c === "/" && c2 === "/") { trong = "//"; r += "  "; i += 2; continue; }
    if (c === "/" && c2 === "*") { trong = "/*"; r += "  "; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") { trong = "str"; nhay = c; r += c; i++; continue; }
    r += c; i++;
  }
  return r;
}

function gomFile(d: string, ra: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.next/.test(e.name)) gomFile(p, ra);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/__tests__|\.test\./.test(p)) {
      ra.push(p);
    }
  }
  return ra;
}

const BO_QUA = new Set(["*", "count", "exact", "planned", "estimated"]);
const LOC = "eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|order|overlaps";

interface Loi { file: string; dong: number; mo_ta: string }

function quet(): { rpc: Loi[]; cot: Loi[]; bang: Loi[] } {
  const loiRpc: Loi[] = [];
  const loiCot: Loi[] = [];
  const loiBang: Loi[] = [];

  for (const f of gomFile(SRC)) {
    const src = xoaGhiChu(fs.readFileSync(f, "utf8"));
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const soDong = (i: number) => src.slice(0, i).split("\n").length;

    for (const m of src.matchAll(/\.rpc\(\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
      if (!RPC.has(m[1])) {
        loiRpc.push({ file: rel, dong: soDong(m.index!), mo_ta: `hàm RPC "${m[1]}" không có trong database` });
      }
    }

    // Tên biến bị dùng lại cho nhiều bảng → không tin được, bỏ qua.
    const gan = new Map<string, Set<string>>();
    for (const m of src.matchAll(
      /(?:const|let|var)\s+(\w+)\s*=\s*[^;]{0,200}?\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g,
    )) {
      if (!gan.has(m[1])) gan.set(m[1], new Set());
      gan.get(m[1])!.add(m[2]);
    }
    const bienBang = new Map<string, string>(
      [...gan].filter(([, t]) => t.size === 1).map(([b, t]) => [b, [...t][0]]),
    );

    const bao = (bang: string, c: string, idx: number, kieu: string) => {
      if (!COT.has(bang)) {
        loiBang.push({ file: rel, dong: soDong(idx), mo_ta: `bảng "${bang}" không có trong database` });
        return;
      }
      if (!c || BO_QUA.has(c) || COT.get(bang)!.has(c)) return;
      if (!/^[a-z_][a-z0-9_]*$/.test(c)) return;
      loiCot.push({ file: rel, dong: soDong(idx), mo_ta: `${bang}.${c} không tồn tại (${kieu})` });
    };

    for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) {
      const bang = m[1];
      const batDau = m.index! + m[0].length;
      let ketThuc = src.length;
      for (const dau of [";", ".from("]) {
        const p = src.indexOf(dau, batDau);
        if (p > 0 && p < ketThuc) ketThuc = p;
      }
      const doan = src.slice(batDau, Math.min(ketThuc, batDau + 2000));

      // select("a, b, rel(c, d)") — bỏ nhóm lồng VÀ tên quan hệ đứng trước "("
      for (const s of doan.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
        let phang = "";
        let sau = 0;
        for (const ch of s[2]) {
          if (ch === "(") { if (sau === 0) phang = phang.replace(/[A-Za-z0-9_!:.]+\s*$/, ""); sau++; }
          else if (ch === ")") sau--;
          else if (sau === 0) phang += ch;
        }
        for (const phan of phang.split(",")) {
          let c = phan.trim();
          if (!c) continue;
          if (c.includes(":")) c = c.split(":").pop()!.trim();
          c = c.split("!")[0].trim();
          bao(bang, c, batDau + s.index!, "select");
        }
      }

      for (const s of doan.matchAll(new RegExp(`\\.(${LOC})\\(\\s*(["'\`])([A-Za-z0-9_]+)\\2`, "g"))) {
        bao(bang, s[3], batDau + s.index!, s[1]);
      }

      // insert/update/upsert — CHỈ khoá tầng ngoài cùng
      for (const s of doan.matchAll(/\.(insert|update|upsert)\(\s*\{/g)) {
        const mo = batDau + s.index! + s[0].length - 1;
        let sau = 0;
        let nhay = "";
        let xong = false;
        const khoa: string[] = [];
        for (let i = mo; i < src.length && i < mo + 4000; i++) {
          const ch = src[i];
          if (nhay) { if (ch === "\\") { i++; continue; } if (ch === nhay) nhay = ""; continue; }
          if (ch === '"' || ch === "'" || ch === "`") { nhay = ch; continue; }
          if ("{[(".includes(ch)) sau++;
          else if ("}])".includes(ch)) { sau--; if (sau === 0) { xong = true; break; } }
          else if (sau === 1) {
            const k = src.slice(i).match(/^([a-z_][a-z0-9_]*)\s*:/);
            // Chỉ nhận khi ký tự có nghĩa liền trước là "{" hoặc "," — nếu không
            // thì đang ở giữa biểu thức (vd `a ? null : b`), không phải tên cột.
            if (k) {
              let j = i - 1;
              while (j >= mo && /\s/.test(src[j])) j--;
              if (src[j] === "{" || src[j] === ",") { khoa.push(k[1]); i += k[1].length; }
            }
          }
        }
        if (xong) for (const k of khoa) bao(bang, k, mo, s[1]);
      }
    }

    for (const [bien, bang] of bienBang) {
      const re = new RegExp(
        `\\b${bien}\\b(?:\\s+as\\s+\\w+\\s*\\))?\\s*\\.(${LOC})\\(\\s*(["'\`])([A-Za-z0-9_]+)\\2`,
        "g",
      );
      for (const s of src.matchAll(re)) bao(bang, s[3], s.index!, `${s[1]} qua biến`);
    }
  }
  return { rpc: loiRpc, cot: loiCot, bang: loiBang };
}

const kq = quet();
const in_ = (ds: Loi[]) => ds.map((x) => `\n  ${x.file}:${x.dong} — ${x.mo_ta}`).join("");

describe("code gọi đúng schema database", () => {
  it("ảnh chụp schema đủ dùng", () => {
    expect(COT.size).toBeGreaterThan(100);
    expect(RPC.size).toBeGreaterThan(200);
  });

  it("không gọi hàm RPC nào không tồn tại", () => {
    expect(kq.rpc.length, `Hàm RPC không có trong database:${in_(kq.rpc)}`).toBe(0);
  });

  it("không đọc/ghi cột nào không tồn tại", () => {
    expect(kq.cot.length, `Cột không tồn tại — câu lệnh sẽ lỗi 42703:${in_(kq.cot)}`).toBe(0);
  });

  it("không truy vấn bảng nào không tồn tại", () => {
    expect(kq.bang.length, `Bảng không có trong database:${in_(kq.bang)}`).toBe(0);
  });
});
