import { openDB, DBSchema, IDBPDatabase } from 'idb';

/**
 * IndexedDB schema for offline POS functionality
 *
 * Stores:
 * - offline_orders: Pending orders created while offline
 * - product_cache: Cached products with stock for offline browsing
 * - sync_queue: Queue of items waiting to sync when online
 */
interface OfflineDB extends DBSchema {
  offline_orders: {
    key: string; // UUID
    value: {
      id: string;
      cart: Array<{
        item: {
          product_id: string;
          name: string;
          price: number;
          stock: number;
        };
        qty: number;
      }>;
      payment_method: string;
      customer_id: string | null;
      customer_name: string;
      total: number;
      created_at: string;
      synced: boolean;
    };
  };
  product_cache: {
    key: string; // product_id
    value: {
      id: string;
      name: string;
      price: number;
      stock: number;
      category: string;
      image_url: string | null;
      cached_at: string;
    };
  };
  sync_queue: {
    key: string;
    value: {
      id: string;
      order_id: string;
      type: 'create_order';
      retry_count: number;
      last_error: string | null;
    };
  };
}

let dbInstance: IDBPDatabase<OfflineDB> | null = null;

/**
 * Get or create IndexedDB instance
 */
export async function getDB(): Promise<IDBPDatabase<OfflineDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<OfflineDB>('onebiz-pos-offline', 1, {
    upgrade(db) {
      // Orders store
      if (!db.objectStoreNames.contains('offline_orders')) {
        db.createObjectStore('offline_orders', { keyPath: 'id' });
      }
      // Product cache
      if (!db.objectStoreNames.contains('product_cache')) {
        db.createObjectStore('product_cache', { keyPath: 'id' });
      }
      // Sync queue
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'id' });
      }
    },
  });

  return dbInstance;
}

/**
 * Save an order offline when no network connection
 */
export async function saveOfflineOrder(order: OfflineDB['offline_orders']['value']): Promise<void> {
  const db = await getDB();
  await db.put('offline_orders', order);
}

/**
 * Get all pending orders waiting to sync
 */
export async function getPendingOrders(): Promise<OfflineDB['offline_orders']['value'][]> {
  const db = await getDB();
  return await db.getAll('offline_orders');
}

/**
 * Cache products for offline browsing
 */
export async function cacheProducts(products: OfflineDB['product_cache']['value'][]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('product_cache', 'readwrite');
  await Promise.all(products.map(p => tx.store.put(p)));
  await tx.done;
}

/**
 * Get cached products for offline mode
 */
export async function getCachedProducts(): Promise<OfflineDB['product_cache']['value'][]> {
  const db = await getDB();
  return await db.getAll('product_cache');
}

/**
 * Mark an order as successfully synced and remove from offline storage
 */
export async function markOrderSynced(orderId: string): Promise<void> {
  const db = await getDB();
  await db.delete('offline_orders', orderId);
}

/**
 * Clear all cached data (useful for logout or tenant switch)
 */
export async function clearAllCache(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['offline_orders', 'product_cache', 'sync_queue'], 'readwrite');
  await Promise.all([
    tx.objectStore('offline_orders').clear(),
    tx.objectStore('product_cache').clear(),
    tx.objectStore('sync_queue').clear(),
  ]);
  await tx.done;
}
