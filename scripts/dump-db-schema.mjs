// Cập nhật ảnh chụp schema dùng cho test code-vs-db.
//
//   node scripts/dump-db-schema.mjs
//
// Chạy lại mỗi khi chạy migration thêm/đổi cột hoặc thêm hàm RPC, rồi commit
// file src/__tests__/schema/db-schema.json cùng migration đó.
//
// Nguồn dữ liệu: bản đặc tả OpenAPI mà PostgREST tự sinh từ database thật —
// không phải file migration, nên không bị lệch khi migration chạy tay.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
for (const p of [".env.local", ".env"]) {
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t[0] === "#") continue;
    const e = t.indexOf("=");
    if (e < 0) continue;
    const k = t.slice(0, e).trim();
    let v = t.slice(e + 1).trim();
    if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const res = await fetch(`${URL_}/rest/v1/`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error(`Không lấy được đặc tả: HTTP ${res.status}`);
  process.exit(1);
}
const spec = await res.json();

const defs = spec.definitions ?? spec.components?.schemas ?? {};
const bang = {};
for (const [ten, d] of Object.entries(defs)) {
  if (d?.properties) bang[ten] = Object.keys(d.properties).sort();
}

const rpc = [];
for (const p of Object.keys(spec.paths ?? {})) {
  const m = p.match(/^\/rpc\/(.+)$/);
  if (m) rpc.push(m[1]);
}
rpc.sort();

const out = {
  bang,
  rpc,
  soBang: Object.keys(bang).length,
  soCot: Object.values(bang).reduce((s, c) => s + c.length, 0),
  soRpc: rpc.length,
};

const dich = path.join(ROOT, "src", "__tests__", "schema", "db-schema.json");
fs.writeFileSync(dich, JSON.stringify(out, null, 1) + "\n");
console.log(`Đã ghi ${path.relative(ROOT, dich)}`);
console.log(`   ${out.soBang} bảng · ${out.soCot} cột · ${out.soRpc} hàm RPC`);
