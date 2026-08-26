/**
 * Cache Manager — prefetch & cache menu/table data into IndexedDB.
 *
 * Strategy: cache-first-then-network
 *   1. Return cached data instantly (zero-network render)
 *   2. Background refresh from Supabase
 *   3. If data changed → update cache + notify via callback
 */

import { getDb, getMeta, setMeta } from "./db";
import { withQuotaRecovery } from "./quota-manager";
import { getClient } from "@/lib/services/supabase/base";
import {
  getToppingPhanHopLe,
  phamViCacheTopping,
  toppingsCacheConHieuLuc,
  type ToppingPhan,
} from "@/lib/services/supabase/fnb-toppings";
import { getTablesByBranch } from "@/lib/services/supabase/fnb-tables";
import {
  filterFnbProductsForBranch,
  getFnbMenuScopeFingerprint,
  listFnbProductBranchMenuScopes,
  type FnbProductBranchMenuScope,
} from "@/lib/services/supabase/fnb-product-branch-menu";
import type { FnbCategory } from "@/app/pos/fnb/components/fnb-category-tabs";
import type { FnbProduct } from "@/app/pos/fnb/components/fnb-product-grid";

// ── Types ──

export interface ToppingProduct {
  id: string;
  name: string;
  price: number;
}

export interface MenuData {
  categories: FnbCategory[];
  products: FnbProduct[];
  toppings: ToppingProduct[];
}

// ── Staleness threshold (30 minutes) ──
const STALE_MS = 30 * 60 * 1000;

// ── Prefetch: Menu ──

function normalizedMenuBranchId(branchId: string | null | undefined): string {
  return branchId ?? "__no_branch__";
}

function menuMetaKey(
  tenantId: string,
  key: string,
  branchId?: string | null,
): string {
  // Variant cache belongs to a product, not a branch. Menu data and its
  // freshness marker must be branch-specific so switching outlets cannot
  // reuse a different outlet's catalog.
  if (key.startsWith("variants_")) return `menu:${tenantId}:${key}`;
  return `menu:${tenantId}:${normalizedMenuBranchId(branchId)}:${key}`;
}

function tablesMetaKey(tenantId: string, branchId: string, key: string): string {
  return `tables:${tenantId}:${branchId}:${key}`;
}

export async function prefetchMenuData(
  tenantId: string,
  branchId: string | null | undefined,
  knownScopes?: FnbProductBranchMenuScope[],
): Promise<void> {
  const supabase = getClient();
  const cachedBranchId = normalizedMenuBranchId(branchId);

  // Fetch categories
  const { data: cats } = await supabase
    .from("categories")
    .select("id, name, code")
    .eq("tenant_id", tenantId)
    .eq("scope", "sku")
    .order("sort_order");

  // Fetch products — chỉ FnB menu (channel='fnb')
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, code, sell_price, image_url, stock, category_id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("product_type", "sku")
    .eq("channel", "fnb")
    .order("name");

  // Scope rows are small but authoritative. Fetch them alongside the catalog
  // unless POS has already obtained the same snapshot for this refresh.
  const [scopes, toppings] = await Promise.all([
    knownScopes
      ? Promise.resolve(knownScopes)
      : listFnbProductBranchMenuScopes(tenantId),
    // 08/08 Giai đoạn 2 topping: SKU-TPP bán theo phần (giá 1 phần + BOM áp
    // dụng ĐÚNG chi nhánh), KHÔNG còn NVL-TOP%. Xem fnb-toppings.ts.
    getToppingPhanHopLe(tenantId, branchId),
  ]);
  const visibleProducts = filterFnbProductsForBranch(
    prods ?? [],
    scopes,
    branchId,
  );

  // Write to IndexedDB — wrap với quota recovery vì menu có thể lớn (500+ SKU
  // × image_url string → dễ đẩy usage gần quota trên Safari mobile).
  await withQuotaRecovery(async () => {
    const db = await getDb();
    const tx = db.transaction("menu_cache", "readwrite");
    const store = tx.objectStore("menu_cache");

    // Refresh only the active branch. Legacy entries do not have a branch id;
    // remove them too so an old shared cache can never leak across branches.
    const existing = await store.getAll();
    for (const record of existing) {
      if (
        record.tenantId === tenantId &&
        (record.branchId === cachedBranchId || record.branchId === undefined)
      ) {
        await store.delete(record.id);
      }
    }

    // Write categories
    for (const c of cats ?? []) {
      await store.put({
        id: `cat_${cachedBranchId}_${c.id}`,
        tenantId,
        branchId: cachedBranchId,
        _type: "category",
        data: { id: c.id, name: c.name, code: c.code },
      });
    }

    // Write products
    for (const p of visibleProducts) {
      await store.put({
        id: `prod_${cachedBranchId}_${p.id}`,
        tenantId,
        branchId: cachedBranchId,
        _type: "product",
        data: {
          id: p.id,
          name: p.name,
          code: p.code,
          sell_price: p.sell_price,
          image_url: (p as Record<string, unknown>).image_url,
          stock: p.stock,
          category_id: p.category_id,
        },
      });
    }

    // Write toppings — đã là {id, name, price} (giá MỘT PHẦN)
    for (const t of toppings) {
      await store.put({
        id: `top_${cachedBranchId}_${t.id}`,
        tenantId,
        branchId: cachedBranchId,
        _type: "topping",
        data: t,
      });
    }

    await tx.done;
  });

  // Update meta timestamps
  const version = computeVersion(visibleProducts, toppings);
  await setMeta(menuMetaKey(tenantId, "last_sync", branchId), Date.now());
  await setMeta(menuMetaKey(tenantId, "version", branchId), version);
  await setMeta(
    menuMetaKey(tenantId, "scope_fingerprint", branchId),
    getFnbMenuScopeFingerprint(scopes),
  );
  // Đóng dấu phạm vi topping (phiên bản nguồn + chi nhánh) — thiếu dấu này
  // (cache đời NVL-TOP) thì lúc đọc bị coi là vô hiệu.
  await setMeta(
    menuMetaKey(tenantId, "topping_scope", branchId),
    phamViCacheTopping(branchId),
  );
}

/**
 * 08/08 — Ghi RIÊNG topping vào cache sau mỗi lần tải online.
 *
 * Vì sao cần: prefetchMenuData chỉ chạy khi menu "stale" (30 phút), nhưng
 * topping theo CHI NHÁNH — thu ngân đổi quán trong cửa 30 phút thì menu
 * không stale mà topping ĐÃ khác. Hàm này xoá sạch topping cũ của tenant
 * (kể cả đời NVL-TOP) rồi ghi bản đúng chi nhánh + đóng dấu phạm vi.
 */
export async function saveToppingsToCache(
  tenantId: string,
  branchId: string | null | undefined,
  toppings: ToppingPhan[],
): Promise<void> {
  const cachedBranchId = normalizedMenuBranchId(branchId);
  await withQuotaRecovery(async () => {
    const db = await getDb();
    const tx = db.transaction("menu_cache", "readwrite");
    const store = tx.objectStore("menu_cache");
    const all = await store.getAll();
    for (const rec of all) {
      if (
        rec.tenantId === tenantId &&
        rec._type === "topping" &&
        (rec.branchId === cachedBranchId || rec.branchId === undefined)
      ) {
        await store.delete(rec.id);
      }
    }
    for (const t of toppings) {
      await store.put({
        id: `top_${cachedBranchId}_${t.id}`,
        tenantId,
        branchId: cachedBranchId,
        _type: "topping",
        data: t,
      });
    }
    await tx.done;
  });
  await setMeta(
    menuMetaKey(tenantId, "topping_scope", branchId),
    phamViCacheTopping(branchId),
  );
}

// ── Prefetch: Tables ──

export async function prefetchTableData(
  tenantId: string,
  branchId: string
): Promise<void> {
  const tables = await getTablesByBranch(branchId);

  await withQuotaRecovery(async () => {
    const db = await getDb();
    const tx = db.transaction("table_cache", "readwrite");
    const store = tx.objectStore("table_cache");

    // Clear old cache for this branch
    const allRecords = await store.index("by_branch").getAll(branchId);
    for (const rec of allRecords) {
      await store.delete(rec.id);
    }

    // Write new data
    for (const t of tables) {
      await store.put({
        id: t.id,
        tenantId,
        branchId,
        data: t,
      });
    }

    await tx.done;
  });
  await setMeta(tablesMetaKey(tenantId, branchId, "last_sync"), Date.now());
}

// ── Read from cache ──

export async function getMenuFromCache(
  tenantId: string,
  branchId: string | null | undefined,
): Promise<MenuData> {
  const db = await getDb();
  const all = await db.getAll("menu_cache");
  const cachedBranchId = normalizedMenuBranchId(branchId);

  // 08/08 (CEO): topping trong cache chỉ dùng được khi ĐÚNG phiên bản nguồn
  // + ĐÚNG chi nhánh. Cache đời NVL-TOP không có dấu phạm vi → vô hiệu ngay
  // từ bản build này; offline thà không hiện topping còn hơn hiện topping
  // nguyên liệu cũ giá nguyên túi/hộp.
  const phamViDaLuu = await getMeta<string>(
    menuMetaKey(tenantId, "topping_scope", branchId),
  ).catch(() => undefined);
  const toppingDungDuoc = toppingsCacheConHieuLuc(phamViDaLuu, branchId);

  const categories: FnbCategory[] = [];
  const products: FnbProduct[] = [];
  const toppings: ToppingProduct[] = [];

  for (const record of all) {
    if (
      record.tenantId !== tenantId ||
      record.branchId !== cachedBranchId
    ) {
      continue;
    }
    switch (record._type) {
      case "category":
        categories.push(record.data as FnbCategory);
        break;
      case "product":
        products.push(record.data as FnbProduct);
        break;
      case "topping":
        if (toppingDungDuoc) toppings.push(record.data as ToppingProduct);
        break;
    }
  }

  return { categories, products, toppings };
}

export async function getTablesFromCache(
  tenantId: string,
  branchId: string
): Promise<unknown[]> {
  const db = await getDb();
  const records = await db
    .transaction("table_cache")
    .objectStore("table_cache")
    .index("by_branch")
    .getAll(branchId);
  return records.filter((r) => r.tenantId === tenantId).map((r) => r.data);
}

// ── Variant cache (v2) ──
// Persist variants per-product qua reload — mỗi SP có 1 record
// { productId, variants: [{id, label, sell_price}], updatedAt }.

export interface VariantLite {
  id: string;
  label: string;
  sell_price: number;
  /** Guard Size: POS phải chọn đúng quy cách mặc định, không lấy phần tử đầu. */
  is_default?: boolean;
}

/** Ghi 1 batch variants vào IndexedDB. Mỗi entry map = 1 record. */
export async function saveVariantsToCache(
  tenantId: string,
  entries: Map<string, VariantLite[]>,
): Promise<void> {
  if (entries.size === 0) return;
  await withQuotaRecovery(async () => {
    const db = await getDb();
    const tx = db.transaction("variant_cache", "readwrite");
    const store = tx.objectStore("variant_cache");
    const now = Date.now();
    for (const [productId, variants] of entries) {
      await store.put({ productId, tenantId, variants, updatedAt: now });
    }
    await tx.done;
  });
  await setMeta(menuMetaKey(tenantId, "variants_last_sync"), Date.now());
}

/** Đọc toàn bộ cached variants → Map để page.tsx warm variantCacheRef. */
export async function getVariantsFromCache(tenantId: string): Promise<Map<string, VariantLite[]>> {
  const map = new Map<string, VariantLite[]>();
  try {
    const db = await getDb();
    const all = await db.getAll("variant_cache");
    for (const rec of all) {
      if (rec.tenantId !== tenantId) continue;
      map.set(rec.productId, rec.variants);
    }
  } catch {
    // DB chưa available (SSR) hoặc store chưa migrate — trả map rỗng
  }
  return map;
}

/** Cache variants stale sau 30 phút giống menu. */
export async function shouldRefreshVariants(tenantId: string): Promise<boolean> {
  const lastSync = await getMeta<number>(menuMetaKey(tenantId, "variants_last_sync"));
  if (!lastSync) return true;
  return Date.now() - lastSync > STALE_MS;
}

/** Xoá variant_cache (dùng khi menu invalidate — variants có thể đổi giá). */
export async function invalidateVariantCache(tenantId?: string): Promise<void> {
  const db = await getDb();
  if (tenantId) {
    const all = await db.getAll("variant_cache");
    const tx = db.transaction(["variant_cache", "meta"], "readwrite");
    for (const rec of all) {
      if (rec.tenantId === tenantId) {
        await tx.objectStore("variant_cache").delete(rec.productId);
      }
    }
    await tx.objectStore("meta").put({
      key: menuMetaKey(tenantId, "variants_last_sync"),
      value: 0,
    });
    await tx.done;
    return;
  }
  await db.clear("variant_cache");
  await setMeta("variants_last_sync", 0);
}

// ── Cache validity ──

export async function shouldRefreshMenu(
  tenantId: string,
  branchId: string | null | undefined,
  scopeFingerprint?: string,
): Promise<boolean> {
  const lastSync = await getMeta<number>(
    menuMetaKey(tenantId, "last_sync", branchId),
  );
  if (!lastSync) return true;
  if (scopeFingerprint !== undefined) {
    const cachedFingerprint = await getMeta<string>(
      menuMetaKey(tenantId, "scope_fingerprint", branchId),
    );
    if (cachedFingerprint !== scopeFingerprint) return true;
  }
  return Date.now() - lastSync > STALE_MS;
}

export async function invalidateMenuCache(tenantId?: string): Promise<void> {
  const db = await getDb();
  if (tenantId) {
    const all = await db.getAll("menu_cache");
    const variants = await db.getAll("variant_cache");
    const tx = db.transaction(["menu_cache", "variant_cache", "meta"], "readwrite");
    for (const record of all) {
      if (record.tenantId === tenantId) {
        await tx.objectStore("menu_cache").delete(record.id);
      }
    }
    for (const record of variants) {
      if (record.tenantId === tenantId) {
        await tx.objectStore("variant_cache").delete(record.productId);
      }
    }
    const metaStore = tx.objectStore("meta");
    const metadata = await metaStore.getAll();
    for (const meta of metadata) {
      if (meta.key.startsWith(`menu:${tenantId}:`)) {
        await metaStore.delete(meta.key);
      }
    }
    await tx.done;
    return;
  }

  await db.clear("menu_cache");
  await setMeta("menu_last_sync", 0);
  await setMeta("menu_version", "");
  // Variants liên kết giá với menu — invalidate luôn để tránh dialog hiện giá cũ.
  try {
    await db.clear("variant_cache");
    await setMeta("variants_last_sync", 0);
  } catch {
    // variant_cache chưa migrate (DB v1) — skip
  }
}

// ── Helpers ──

function computeVersion(
  prods: { id: string }[],
  toppings: { id: string }[]
): string {
  const ids = [...prods.map((p) => p.id), ...toppings.map((t) => t.id)]
    .sort()
    .join(",");
  // Simple hash
  let hash = 0;
  for (let i = 0; i < ids.length; i++) {
    const ch = ids.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0;
  }
  return hash.toString(36);
}
