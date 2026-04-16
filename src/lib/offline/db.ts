/**
 * IndexedDB schema for FnB offline support.
 * Uses `idb` — lightweight Promise wrapper (~1.2KB).
 *
 * Stores:
 *   menu_cache     — products, categories, toppings (cache-first loading)
 *   table_cache    — restaurant tables
 *   pending_orders — orders created while offline
 *   sync_queue     — FIFO replay queue for offline mutations
 *   meta           — version stamps, counters, timestamps
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// ── Record types ──

export interface MenuCacheRecord {
  id: string;
  _type: "product" | "category" | "topping";
  data: unknown; // FnbProduct | FnbCategory | ToppingProduct
}

export interface TableCacheRecord {
  id: string;
  branchId: string;
  data: unknown; // RestaurantTable
}

export interface PendingOrder {
  localId: string;
  tenantId: string;
  branchId: string;
  localOrderNumber: string;
  orderType: "dine_in" | "takeaway" | "delivery";
  tableId?: string;
  items: unknown[];
  note?: string;
  status: "pending_kitchen" | "pending_payment" | "synced" | "failed";
  serverOrderId?: string;
  serverOrderNumber?: string;
  paymentData?: unknown;
  serverInvoiceId?: string;
  serverInvoiceCode?: string;
  createdAt: string;
  updatedAt: string;
}

export type SyncAction =
  | "sendToKitchen"
  | "fnbPayment"
  | "addItems"
  | "updateItemStatus"
  | "updateOrderStatus";

export interface SyncQueueEntry {
  id?: number;
  action: SyncAction;
  payload: unknown;
  localId: string;
  status: "pending" | "syncing" | "completed" | "failed";
  attempts: number;
  lastAttempt: string | null;
  error: string | null;
  createdAt: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

// ── DB Schema ──

interface OneBizFnbDB extends DBSchema {
  menu_cache: {
    key: string;
    value: MenuCacheRecord;
    indexes: {
      by_type: string;
      by_category: string;
    };
  };
  table_cache: {
    key: string;
    value: TableCacheRecord;
    indexes: {
      by_branch: string;
    };
  };
  pending_orders: {
    key: string;
    value: PendingOrder;
    indexes: {
      by_status: string;
      by_created: string;
    };
  };
  sync_queue: {
    key: number;
    value: SyncQueueEntry;
    indexes: {
      by_action: string;
      by_status: string;
      by_created: string;
    };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

// ── Singleton ──

const DB_NAME = "onebiz-fnb-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OneBizFnbDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<OneBizFnbDB>> {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is not available on server");
  }

  if (!dbPromise) {
    dbPromise = openDB<OneBizFnbDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // menu_cache
        if (!db.objectStoreNames.contains("menu_cache")) {
          const menuStore = db.createObjectStore("menu_cache", {
            keyPath: "id",
          });
          menuStore.createIndex("by_type", "_type");
          menuStore.createIndex("by_category", "data.category_id");
        }

        // table_cache
        if (!db.objectStoreNames.contains("table_cache")) {
          const tableStore = db.createObjectStore("table_cache", {
            keyPath: "id",
          });
          tableStore.createIndex("by_branch", "branchId");
        }

        // pending_orders
        if (!db.objectStoreNames.contains("pending_orders")) {
          const orderStore = db.createObjectStore("pending_orders", {
            keyPath: "localId",
          });
          orderStore.createIndex("by_status", "status");
          orderStore.createIndex("by_created", "createdAt");
        }

        // sync_queue (autoIncrement)
        if (!db.objectStoreNames.contains("sync_queue")) {
          const syncStore = db.createObjectStore("sync_queue", {
            keyPath: "id",
            autoIncrement: true,
          });
          syncStore.createIndex("by_action", "action");
          syncStore.createIndex("by_status", "status");
          syncStore.createIndex("by_created", "createdAt");
        }

        // meta
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
    });
  }

  return dbPromise;
}

// ── Helpers ──

export async function getMeta<T = unknown>(
  key: string
): Promise<T | undefined> {
  const db = await getDb();
  const record = await db.get("meta", key);
  return record?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put("meta", { key, value });
}
