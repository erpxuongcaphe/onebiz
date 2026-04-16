/**
 * Cache Manager — prefetch & cache menu/table data into IndexedDB.
 *
 * Strategy: cache-first-then-network
 *   1. Return cached data instantly (zero-network render)
 *   2. Background refresh from Supabase
 *   3. If data changed → update cache + notify via callback
 */

import { getDb, getMeta, setMeta, type MenuCacheRecord } from "./db";
import { getClient } from "@/lib/services/supabase/base";
import { getTablesByBranch } from "@/lib/services/supabase/fnb-tables";
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

export async function prefetchMenuData(): Promise<void> {
  const supabase = getClient();

  // Fetch categories
  const { data: cats } = await supabase
    .from("categories")
    .select("id, name, code")
    .eq("scope", "sku")
    .order("sort_order");

  // Fetch products
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, code, sell_price, image_url, stock, category_id")
    .eq("is_active", true)
    .eq("product_type", "sku")
    .order("name");

  // Fetch toppings
  const { data: toppings } = await supabase
    .from("products")
    .select("id, name, sell_price")
    .eq("is_active", true)
    .ilike("code", "NVL-TOP%");

  // Write to IndexedDB in a single transaction
  const db = await getDb();
  const tx = db.transaction("menu_cache", "readwrite");
  const store = tx.objectStore("menu_cache");

  // Clear old cache
  await store.clear();

  // Write categories
  for (const c of cats ?? []) {
    await store.put({
      id: `cat_${c.id}`,
      _type: "category",
      data: { id: c.id, name: c.name, code: c.code },
    });
  }

  // Write products
  for (const p of prods ?? []) {
    await store.put({
      id: `prod_${p.id}`,
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

  // Write toppings
  for (const t of toppings ?? []) {
    await store.put({
      id: `top_${t.id}`,
      _type: "topping",
      data: { id: t.id, name: t.name, price: t.sell_price },
    });
  }

  await tx.done;

  // Update meta timestamps
  const version = computeVersion(prods ?? [], toppings ?? []);
  await setMeta("menu_last_sync", Date.now());
  await setMeta("menu_version", version);
}

// ── Prefetch: Tables ──

export async function prefetchTableData(
  branchId: string
): Promise<void> {
  const tables = await getTablesByBranch(branchId);

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
      branchId,
      data: t,
    });
  }

  await tx.done;
  await setMeta("tables_last_sync", Date.now());
}

// ── Read from cache ──

export async function getMenuFromCache(): Promise<MenuData> {
  const db = await getDb();
  const all = await db.getAll("menu_cache");

  const categories: FnbCategory[] = [];
  const products: FnbProduct[] = [];
  const toppings: ToppingProduct[] = [];

  for (const record of all) {
    switch (record._type) {
      case "category":
        categories.push(record.data as FnbCategory);
        break;
      case "product":
        products.push(record.data as FnbProduct);
        break;
      case "topping":
        toppings.push(record.data as ToppingProduct);
        break;
    }
  }

  return { categories, products, toppings };
}

export async function getTablesFromCache(
  branchId: string
): Promise<unknown[]> {
  const db = await getDb();
  const records = await db
    .transaction("table_cache")
    .objectStore("table_cache")
    .index("by_branch")
    .getAll(branchId);
  return records.map((r) => r.data);
}

// ── Cache validity ──

export async function shouldRefreshMenu(): Promise<boolean> {
  const lastSync = await getMeta<number>("menu_last_sync");
  if (!lastSync) return true;
  return Date.now() - lastSync > STALE_MS;
}

export async function invalidateMenuCache(): Promise<void> {
  const db = await getDb();
  await db.clear("menu_cache");
  await setMeta("menu_last_sync", 0);
  await setMeta("menu_version", "");
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
