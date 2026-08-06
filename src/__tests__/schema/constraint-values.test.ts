/**
 * Chặn tận gốc loại lỗi "ghi giá trị không có trong ràng buộc CHECK".
 *
 * Đã nổ 2 lần trong 1 ngày (29/07/2026):
 *  - 00149 đặt product_lots.status = 'cancelled' → CEO không huỷ được phiếu
 *    nhập, lỗi 23514. Nằm im từ 24/06 vì chỉ nổ khi lô đã bán bớt.
 *  - 00229 bỏ ép kitchen_orders.status='completed' làm guard "đã thu tiền"
 *    mất chỗ dựa → thu tiền được nhiều lần.
 *
 * Cả hai đều là: CODE và RÀNG BUỘC nói hai thứ khác nhau, và không ai đối
 * chiếu cho tới khi người dùng gặp. Test này đối chiếu tự động.
 *
 * Cách chạy: mọi lần `npx vitest run`. Thêm giá trị mới vào CHECK thì test
 * tự nhận; ghi giá trị lạ thì test đỏ ngay.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");
const SRC = path.join(process.cwd(), "src");

/** "bang.cot" -> { giaTri, file } — lấy bản MỚI NHẤT (file sau đè file trước). */
function gomRangBuoc() {
  const rangBuoc = new Map<string, { giaTri: Set<string>; file: string }>();
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/\r\n/g, "\n");
    for (const khoi of sql.split(/;\s*\n/)) {
      const mCreate = khoi.match(/create table (?:if not exists )?public\.([a-z_]+)/i);
      const mAlter = khoi.match(/alter table (?:only )?public\.([a-z_]+)/i);
      const bang = mAlter?.[1] ?? mCreate?.[1];
      if (!bang) continue;

      const re = /check\s*\(\s*([a-z_]+)\s+in\s*\(([^)]*)\)/gi;
      let c: RegExpExecArray | null;
      while ((c = re.exec(khoi)) !== null) {
        const vals = [...c[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
        if (!vals.length) continue;
        rangBuoc.set(`${bang}.${c[1]}`, { giaTri: new Set(vals), file: f });
      }
    }
  }
  return rangBuoc;
}

/** Duyệt mọi file .ts/.tsx dưới src. */
function fileNguon(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      fileNguon(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("Giá trị ghi vào CSDL phải nằm trong ràng buộc CHECK", () => {
  const rangBuoc = gomRangBuoc();

  it("đọc được ràng buộc từ migrations", () => {
    expect(rangBuoc.size).toBeGreaterThan(30);
    // mốc neo: nếu ai đó siết lại product_lots.status mà quên 'cancelled'
    // thì luồng huỷ phiếu nhập chết như 29/07 — test này chặn.
    expect(rangBuoc.get("product_lots.status")?.giaTri.has("cancelled")).toBe(true);
  });

  it("migrations: không câu UPDATE nào ghi giá trị lạ", () => {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const viPham: string[] = [];

    for (const f of files) {
      const dong = fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/\r\n/g, "\n").split("\n");
      let bangDangGhi: string | null = null;

      dong.forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith("--")) return;
        const mUp = t.match(/^update\s+public\.([a-z_]+)/i);
        if (mUp) bangDangGhi = mUp[1];
        else if (/^(insert|select|delete|create|alter|drop)\b/i.test(t)) bangDangGhi = null;
        if (!bangDangGhi) return;

        const truocWhere = t.split(/\bwhere\b/i)[0];
        const re = /([a-z_]+)\s*=\s*'([a-z_]+)'/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(truocWhere)) !== null) {
          const rb = rangBuoc.get(`${bangDangGhi}.${m[1]}`);
          if (!rb || rb.giaTri.has(m[2])) continue;
          viPham.push(`${f}:${i + 1} — ${bangDangGhi}.${m[1]} = '${m[2]}' (hợp lệ: ${[...rb.giaTri].join("/")})`);
        }
      });
    }

    expect(viPham, `Ghi giá trị không có trong ràng buộc:\n${viPham.join("\n")}`).toEqual([]);
    // 06/08: quét 300+ file migration — chạy CHUNG suite bị nghẽn CPU vượt trần
    // 5s mặc định (chạy riêng chỉ ~2s). Nới trần cho hết flake.
  }, 30_000);

  it("mã nguồn: không chỗ nào ghi giá trị lạ qua .from(bảng).update/insert", () => {
    const viPham: string[] = [];

    for (const p of fileNguon(SRC)) {
      const src = fs.readFileSync(p, "utf8");
      // .from("bang").update({ cot: "gia_tri" })
      //
      // Khoảng giữa KHÔNG được chứa `.from(` khác — nếu không sẽ ghép nhầm
      // tên bảng của câu này với dữ liệu của câu sau. Bản đầu quét 600 ký tự
      // tự do nên báo 4 lỗi giả (agent_tasks / production_orders /
      // kitchen_order_items / kitchen_orders) — thực chất đều là `.select()`
      // hoặc payload là BIẾN, không phải chuỗi cố định.
      const re =
        /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)((?:(?!\.from\()[\s\S]){0,200}?)\.(update|insert|upsert)\(\s*(\{(?:[^{}]|\{[^{}]*\}){0,400}?\})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const bang = m[1];
        const payload = m[4];
        const reCot = /([a-z_]+)\s*:\s*["'`]([a-z_]+)["'`]/g;
        let c: RegExpExecArray | null;
        while ((c = reCot.exec(payload)) !== null) {
          const rb = rangBuoc.get(`${bang}.${c[1]}`);
          if (!rb || rb.giaTri.has(c[2])) continue;
          const dong = src.slice(0, m.index).split("\n").length;
          viPham.push(
            `${path.relative(process.cwd(), p)}:${dong} — ${bang}.${c[1]} = '${c[2]}' (hợp lệ: ${[...rb.giaTri].join("/")})`,
          );
        }
      }
    }

    expect(viPham, `Ghi giá trị không có trong ràng buộc:\n${viPham.join("\n")}`).toEqual([]);
  }, 15_000);
});
