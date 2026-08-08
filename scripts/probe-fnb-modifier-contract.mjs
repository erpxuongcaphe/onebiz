/**
 * DÒ CHỈ ĐỌC — hợp đồng tuỳ chọn món F&B trên Supabase thật.
 * Chỉ GET (SELECT). Không POST/PATCH/DELETE, không RPC ghi.
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((d) => d.includes("=") && !d.trim().startsWith("#"))
    .map((d) => {
      const i = d.indexOf("=");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error("thieu env");

async function get(path) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: r.ok, status: r.status, body };
}

const ket = [];
function ghi(ten, kq, tomTat) {
  ket.push({ ten, status: kq.status, ok: kq.ok, tomTat });
  console.log(
    `${kq.ok ? "OK  " : "LOI "} [${kq.status}] ${ten}` + (tomTat ? ` — ${tomTat}` : ""),
  );
  if (!kq.ok) console.log("      ", JSON.stringify(kq.body).slice(0, 300));
}

console.log("=== 1. CỘT CÓ THẬT KHÔNG ===");
ghi(
  "modifier_groups.channel",
  await get("modifier_groups?select=id,name,rule,channel,sort_order,is_active&limit=5"),
);
ghi(
  "product_modifier_groups.rule_override + sort_order",
  await get("product_modifier_groups?select=id,product_id,modifier_group_id,rule_override,sort_order&limit=5"),
);
ghi(
  "category_modifier_groups.sort_order",
  await get("category_modifier_groups?select=id,category_id,modifier_group_id,sort_order&limit=5"),
);

console.log("\n=== 2. TRUY VẤN CLIENT ĐANG DÙNG ===");
const nhomHoatDong = await get(
  "modifier_groups?select=*,modifier_options(count)&is_active=eq.true&channel=in.(fnb,all)&limit=50",
);
ghi(
  "select *,modifier_options(count) + is_active + channel=in.(fnb,all)",
  nhomHoatDong,
  Array.isArray(nhomHoatDong.body) ? `${nhomHoatDong.body.length} nhóm` : "",
);

console.log("\n=== 3. PHÂN BỐ channel ===");
const tatCaNhom = await get("modifier_groups?select=id,name,rule,channel,sort_order,is_active");
if (tatCaNhom.ok) {
  const dem = {};
  for (const g of tatCaNhom.body) {
    const k = `${g.channel}/${g.is_active ? "đang dùng" : "đã tắt"}`;
    dem[k] = (dem[k] ?? 0) + 1;
  }
  console.log("   ", JSON.stringify(dem));
  const ngoaiFnb = tatCaNhom.body.filter(
    (g) => g.is_active && g.channel !== "fnb" && g.channel !== "all",
  );
  console.log(
    `    nhóm ĐANG DÙNG nhưng channel ngoài (fnb,all): ${ngoaiFnb.length}`,
    ngoaiFnb.map((g) => `${g.name}[${g.channel}]`).join(", "),
  );
  console.log(
    "    danh sách nhóm:",
    tatCaNhom.body
      .map((g) => `${g.name} (rule=${g.rule}, channel=${g.channel}, sort=${g.sort_order}, ${g.is_active ? "on" : "off"})`)
      .join(" | "),
  );
}

console.log("\n=== 4. rule_override THỰC TẾ (cấp món) ===");
const lienKetMon = await get(
  "product_modifier_groups?select=id,product_id,modifier_group_id,rule_override,sort_order",
);
if (lienKetMon.ok) {
  const co = lienKetMon.body.filter((l) => l.rule_override !== null);
  console.log(
    `    tổng liên kết cấp món: ${lienKetMon.body.length} · có rule_override: ${co.length}`,
  );
}

console.log("\n=== 5. THỨ TỰ LIÊN KẾT CÓ KHÁC THỨ TỰ NHÓM KHÔNG (cấp nhóm hàng) ===");
const lienKetCat = await get(
  "category_modifier_groups?select=id,category_id,modifier_group_id,sort_order",
);
if (lienKetCat.ok && tatCaNhom.ok) {
  const nhomTheoId = new Map(tatCaNhom.body.map((g) => [g.id, g]));
  const theoCat = new Map();
  for (const l of lienKetCat.body) {
    if (!theoCat.has(l.category_id)) theoCat.set(l.category_id, []);
    theoCat.get(l.category_id).push(l);
  }
  console.log(
    `    tổng liên kết cấp nhóm hàng: ${lienKetCat.body.length} · số nhóm hàng có gán: ${theoCat.size}`,
  );
  let soLech = 0;
  const viDu = [];
  for (const [catId, ds] of theoCat) {
    if (ds.length < 2) continue;
    const theoLienKet = [...ds]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((l) => l.modifier_group_id);
    const theoNhom = [...ds]
      .sort(
        (a, b) =>
          (nhomTheoId.get(a.modifier_group_id)?.sort_order ?? 0) -
          (nhomTheoId.get(b.modifier_group_id)?.sort_order ?? 0),
      )
      .map((l) => l.modifier_group_id);
    if (JSON.stringify(theoLienKet) !== JSON.stringify(theoNhom)) {
      soLech++;
      if (viDu.length < 5) {
        viDu.push({
          catId,
          theoLienKet: theoLienKet.map((id) => nhomTheoId.get(id)?.name ?? id),
          theoNhom: theoNhom.map((id) => nhomTheoId.get(id)?.name ?? id),
        });
      }
    }
  }
  console.log(`    nhóm hàng có thứ tự LỆCH: ${soLech}`);
  for (const v of viDu) {
    console.log(`      cat ${v.catId}`);
    console.log(`        theo liên kết: ${v.theoLienKet.join(" → ")}`);
    console.log(`        theo nhóm    : ${v.theoNhom.join(" → ")}`);
  }
  const phanBoSort = {};
  for (const l of lienKetCat.body) {
    phanBoSort[l.sort_order ?? "null"] = (phanBoSort[l.sort_order ?? "null"] ?? 0) + 1;
  }
  console.log("    phân bố sort_order của liên kết:", JSON.stringify(phanBoSort));
}

console.log("\n=== TỔNG ===");
console.log(`${ket.filter((k) => k.ok).length}/${ket.length} truy vấn chạy được`);
