/**
 * Offline module — barrel exports
 */

// Database
export { getDb, getMeta, setMeta } from "./db";
export type {
  MenuCacheRecord,
  TableCacheRecord,
  PendingOrder,
  SyncQueueEntry,
  SyncAction,
  MetaRecord,
} from "./db";

// Cache manager
export {
  prefetchMenuData,
  prefetchTableData,
  getMenuFromCache,
  getTablesFromCache,
  shouldRefreshMenu,
  invalidateMenuCache,
} from "./cache-manager";
export type { MenuData, ToppingProduct } from "./cache-manager";

// Sync manager
export {
  enqueue,
  replayQueue,
  getPendingCount,
  getFailedCount,
  getQueueEntries,
  retryFailedEntries,
  retryQueueEntry,
  deleteQueueEntry,
  clearCompleted,
} from "./sync-manager";
export type { SyncResult } from "./sync-manager";

// Network status hook
export { useNetworkStatus } from "./use-network-status";
export type { NetworkStatus } from "./use-network-status";

// Offline checkout
export {
  offlineSendToKitchen,
  offlineFnbPayment,
  offlineAddItemsToExistingOrder,
  offlinePosCheckout,
} from "./offline-checkout";

// Haptic feedback
export { hapticTap, hapticSuccess, hapticError } from "./haptic";

// Quota manager
export {
  isQuotaExceededError,
  getStorageEstimate,
  requestPersistentStorage,
  performEmergencyCleanup,
  withQuotaRecovery,
  checkQuotaHealth,
  formatBytes,
  QUOTA_WARN_PERCENT,
  QUOTA_CRITICAL_PERCENT,
} from "./quota-manager";
export type {
  StorageEstimate,
  EmergencyCleanupResult,
  QuotaHealthCheck,
} from "./quota-manager";
