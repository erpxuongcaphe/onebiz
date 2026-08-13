// Read-only FnB go-live audit. This script never writes to Supabase.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const filename of [".env.local", ".env"]) {
  const file = path.join(process.cwd(), filename);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const separator = value.indexOf("=");
    if (separator < 0) continue;
    const key = value.slice(0, separator).trim();
    let content = value.slice(separator + 1).trim();
    if (/^["'].*["']$/.test(content)) content = content.slice(1, -1);
    if (!process.env[key]) process.env[key] = content;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function select(table, columns, build = (query) => query) {
  const { data, error } = await build(supabase.from(table).select(columns));
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

const toppingProducts = await select(
  "products",
  "id,tenant_id,code,name,sell_price,unit,has_bom,bom_code,is_active,channel,product_type",
  (query) => query.ilike("code", "SKU-TPP%"),
);

const tenantIds = [...new Set(toppingProducts.map((row) => row.tenant_id))];
const tenants = tenantIds.length
  ? await select("tenants", "id,name", (query) => query.in("id", tenantIds))
  : [];
const tenantNames = new Map(tenants.map((row) => [row.id, row.name]));

for (const tenantId of tenantIds) {
  const products = toppingProducts.filter((row) => row.tenant_id === tenantId);
  const productIds = products.map((row) => row.id);
  const bomCodes = products.map((row) => row.bom_code).filter(Boolean);

  const boms = await select(
    "bom",
    "id,product_id,code,branch_id,is_active",
    (query) => {
      let scoped = query.eq("tenant_id", tenantId).eq("is_active", true);
      const filters = [];
      if (productIds.length) filters.push(`product_id.in.(${productIds.join(",")})`);
      if (bomCodes.length) filters.push(`code.in.(${bomCodes.map((code) => `"${code}"`).join(",")})`);
      return filters.length ? scoped.or(filters.join(",")) : scoped.limit(0);
    },
  );
  const bomIds = boms.map((row) => row.id);
  const bomItems = bomIds.length
    ? await select(
        "bom_items",
        "bom_id,material_id,quantity,unit,modifier_scale_target",
        (query) => query.in("bom_id", bomIds),
      )
    : [];

  const groups = await select(
    "modifier_groups",
    "id,name,rule,is_active,channel,sort_order,min_select,max_select",
    (query) => query.eq("tenant_id", tenantId).in("channel", ["fnb", "all"]),
  );
  const groupIds = groups.map((row) => row.id);
  const options = groupIds.length
    ? await select(
        "modifier_options",
        "group_id,label,is_active,is_default,scale_factor,linked_product_id,sort_order",
        (query) => query.in("group_id", groupIds),
      )
    : [];
  const linkedProductIds = [
    ...new Set(options.map((option) => option.linked_product_id).filter(Boolean)),
  ];
  const linkedProducts = linkedProductIds.length
    ? await select("products", "id,code,name,unit", (query) =>
        query.eq("tenant_id", tenantId).in("id", linkedProductIds),
      )
    : [];
  const linkedById = new Map(linkedProducts.map((product) => [product.id, product]));
  const fnbProducts = await select(
    "products",
    "id,code,name,category_id,has_bom,bom_code,is_active",
    (query) =>
      query
        .eq("tenant_id", tenantId)
        .eq("product_type", "sku")
        .eq("channel", "fnb")
        .eq("is_active", true),
  );
  const fnbProductIds = fnbProducts.map((product) => product.id);
  const variants = fnbProductIds.length
    ? await select(
        "product_variants",
        "product_id,name,bom_code,is_active",
        (query) => query.eq("tenant_id", tenantId).eq("is_active", true).in("product_id", fnbProductIds),
      )
    : [];
  const categoryLinks = await select(
    "category_modifier_groups",
    "category_id,modifier_group_id,sort_order",
    (query) => query.eq("tenant_id", tenantId),
  );

  const applicableBom = (product) => {
    const matching = product.bom_code
      ? boms.filter((bom) => bom.code === product.bom_code)
      : boms.filter((bom) => bom.product_id === product.id);
    return matching.some((bom) => bomItems.some((item) => item.bom_id === bom.id));
  };

  console.log(`\n=== ${tenantNames.get(tenantId) ?? "Doanh nghiệp"} ===`);
  console.table(
    products
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((product) => ({
        ma: product.code,
        ten: product.name,
        gia_phan: Number(product.sell_price ?? 0),
        don_vi: product.unit,
        dang_bat: Boolean(product.is_active),
        dung_loai: product.product_type === "sku" && product.channel === "fnb",
        co_bom_ap_dung: applicableBom(product),
      })),
  );

  const readiness = products.filter(
    (product) =>
      product.is_active &&
      product.product_type === "sku" &&
      product.channel === "fnb" &&
      Number(product.sell_price ?? 0) > 0 &&
      applicableBom(product),
  );
  console.log(`Topping sẵn sàng: ${readiness.length}/${products.length}`);
  const productsWithVariants = new Set(variants.map((variant) => variant.product_id));
  console.table([
    {
      mon_fnb_dang_bat: fnbProducts.length,
      mon_co_quy_cach: productsWithVariants.size,
      tong_quy_cach: variants.length,
      quy_cach_co_bom_rieng: variants.filter((variant) => Boolean(variant.bom_code)).length,
      mon_bat_co_bom: fnbProducts.filter((product) => Boolean(product.has_bom)).length,
      mon_co_ma_bom_cha: fnbProducts.filter((product) => Boolean(product.bom_code)).length,
    },
  ]);

  const relevantGroups = groups.filter((group) => {
    const folded = group.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
    return /duong|topping/i.test(folded);
  });
  const scaleTargetCount = new Map();
  for (const item of bomItems) {
    if (!item.modifier_scale_target) continue;
    scaleTargetCount.set(
      item.modifier_scale_target,
      (scaleTargetCount.get(item.modifier_scale_target) ?? 0) + 1,
    );
  }
  console.table(
    relevantGroups.map((group) => {
      const groupOptions = options.filter((option) => option.group_id === group.id);
      return {
        nhom: group.name,
        dang_bat: Boolean(group.is_active),
        quy_tac: group.rule,
        mac_dinh_dang_bat: groupOptions.filter((option) => option.is_active && option.is_default).length,
        lua_chon_lien_ket_san_pham: groupOptions.filter(
          (option) => option.is_active && option.linked_product_id,
        ).length,
        dong_bom_dung_he_so: scaleTargetCount.get(group.id) ?? 0,
        gioi_han:
          group.rule === "multi"
            ? `${group.min_select ?? 0}..${group.max_select ?? "không giới hạn"}`
            : "-",
      };
    }),
  );

  for (const group of relevantGroups) {
    console.log(`Nhóm ${group.name}:`);
    console.table(
      options
        .filter((option) => option.group_id === group.id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((option) => ({
          lua_chon: option.label,
          dang_bat: Boolean(option.is_active),
          mac_dinh: Boolean(option.is_default),
          he_so: option.scale_factor,
          san_pham_lien_ket: option.linked_product_id
            ? `${linkedById.get(option.linked_product_id)?.code ?? "?"} - ${linkedById.get(option.linked_product_id)?.name ?? "Không tìm thấy"}`
            : "-",
        })),
    );
  }

  const linkedGroups = groups
    .map((group) => ({
      group,
      linkedOptions: options.filter(
        (option) => option.group_id === group.id && option.is_active && option.linked_product_id,
      ),
    }))
    .filter((entry) => entry.linkedOptions.length > 0);
  console.log("Các nhóm đang liên kết trực tiếp tới sản phẩm:");
  console.table(
    linkedGroups.map(({ group, linkedOptions }) => ({
      nhom: group.name,
      quy_tac: group.rule,
      so_lua_chon: linkedOptions.length,
      he_so: [...new Set(linkedOptions.map((option) => option.scale_factor))].join(", "),
      dong_bom_dung_he_so: scaleTargetCount.get(group.id) ?? 0,
    })),
  );
  console.log("Tổng quan toàn bộ nhóm tuỳ chọn F&B:");
  console.table(
    groups
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((group) => {
        const groupOptions = options.filter(
          (option) => option.group_id === group.id && option.is_active,
        );
        return {
          nhom: group.name,
          dang_bat: Boolean(group.is_active),
          quy_tac: group.rule,
          so_lua_chon: groupOptions.length,
          he_so: [...new Set(groupOptions.map((option) => option.scale_factor))].join(", "),
          lien_ket_san_pham: groupOptions.filter((option) => option.linked_product_id).length,
          dong_bom_dung_he_so: scaleTargetCount.get(group.id) ?? 0,
        };
      }),
  );
  console.log("Phạm vi gắn nhóm tuỳ chọn theo nhóm hàng:");
  console.table(
    groups.map((group) => ({
      nhom: group.name,
      dang_bat: Boolean(group.is_active),
      so_nhom_hang_duoc_gan: categoryLinks.filter(
        (link) => link.modifier_group_id === group.id,
      ).length,
    })),
  );
}

if (tenantIds.length === 0) {
  console.log("Không tìm thấy mã SKU-TPP nào.");
}
