"use client";

/**
 * Persist FnB tabs (cart) qua reload bằng IndexedDB meta store.
 *
 * R12: Trước đây `useFnbPosState` dùng `useState` in-memory — barista lỡ
 * reload (Cmd+R / iPad đi ngủ) hoặc đổi ca giữa peak hour → mất hết cart
 * 3-5 đơn dở. Giờ tabs auto-saved sau mỗi state change (debounced 300ms),
 * restore khi mount.
 *
 * Key store: `fnb-tabs:<branchId>` — mỗi branch có session riêng, đổi
 * branch không kéo cart qua (đã có resetAllTabs).
 */

import { getMeta, setMeta } from "@/lib/offline/db";
import type { FnbTabSnapshot } from "@/lib/types/fnb";

const KEY_PREFIX = "fnb-tabs:";
/** Tabs cũ hơn 24h → bỏ qua (cashier khác đã đóng ca). */
const STALE_MS = 24 * 60 * 60 * 1000;

interface PersistedTabsRecord {
  branchId: string;
  tabs: FnbTabSnapshot[];
  activeTabId: string;
  savedAt: number;
}

export async function loadPersistedTabs(
  branchId: string,
): Promise<{ tabs: FnbTabSnapshot[]; activeTabId: string } | null> {
  if (typeof window === "undefined") return null;
  try {
    const record = await getMeta<PersistedTabsRecord>(KEY_PREFIX + branchId);
    if (!record) return null;
    if (Date.now() - record.savedAt > STALE_MS) return null;
    if (!record.tabs || record.tabs.length === 0) return null;
    return { tabs: record.tabs, activeTabId: record.activeTabId };
  } catch (err) {
    console.warn("[FnB] loadPersistedTabs failed:", err);
    return null;
  }
}

export async function savePersistedTabs(
  branchId: string,
  tabs: FnbTabSnapshot[],
  activeTabId: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const record: PersistedTabsRecord = {
      branchId,
      tabs,
      activeTabId,
      savedAt: Date.now(),
    };
    await setMeta(KEY_PREFIX + branchId, record);
  } catch (err) {
    console.warn("[FnB] savePersistedTabs failed:", err);
  }
}

export async function clearPersistedTabs(branchId: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await setMeta(KEY_PREFIX + branchId, null);
  } catch (err) {
    console.warn("[FnB] clearPersistedTabs failed:", err);
  }
}
