import type { PosSnapshot } from "../hooks/use-pos-state";

export interface RetailInvoiceTab {
  id: string;
  label: string;
  snapshot: PosSnapshot | null;
  itemCount: number;
  sessionId: string;
  ngayHoaDon: string | null;
  lyDoNgayHoaDon: string;
}
export interface RetailWorkspace { tabs: RetailInvoiceTab[]; activeTabId: string }
const maxAge = 7 * 24 * 60 * 60 * 1000;
const key = (tenantId: string, branchId: string, userId: string) =>
  `onebiz:pos:retail:workspace:v1:${tenantId}:${branchId}:${userId}`;

/** Session storage survives F5 and isolates independent browser POS windows. */
export function saveRetailWorkspace(
  tenantId: string, branchId: string, userId: string,
  workspace: RetailWorkspace, activeSnapshot: PosSnapshot,
  invoiceDate: { iso: string | null; lyDo: string },
): void {
  try {
    const tabs = workspace.tabs.map((tab) => tab.id === workspace.activeTabId
      ? { ...tab, snapshot: activeSnapshot, ngayHoaDon: invoiceDate.iso, lyDoNgayHoaDon: invoiceDate.lyDo }
      : tab);
    sessionStorage.setItem(key(tenantId, branchId, userId), JSON.stringify({
      tabs, activeTabId: workspace.activeTabId, savedAt: Date.now(),
    }));
  } catch { /* Storage blocked/full: existing server draft recovery remains. */ }
}
export function loadRetailWorkspace(
  tenantId: string, branchId: string, userId: string,
): RetailWorkspace | null {
  try {
    const raw = sessionStorage.getItem(key(tenantId, branchId, userId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.savedAt) || Date.now() - value.savedAt > maxAge ||
      !Array.isArray(value.tabs) || !value.tabs.length) return null;
    const ids = new Set<string>();
    for (const tab of value.tabs) {
      if (typeof tab.id !== "string" || ids.has(tab.id) ||
        typeof tab.label !== "string" || typeof tab.sessionId !== "string" ||
        (tab.snapshot !== null && (!Array.isArray(tab.snapshot?.lines) ||
          !tab.snapshot.orderDiscount || !tab.snapshot.deliveryInfo))) return null;
      ids.add(tab.id);
    }
    if (!ids.has(value.activeTabId) || !value.tabs.find((tab: RetailInvoiceTab) => tab.id === value.activeTabId)?.snapshot) return null;
    return { tabs: value.tabs, activeTabId: value.activeTabId };
  } catch { return null; }
}

/** A link to another draft opens a new invoice without discarding restored tabs. */
export function planRetailWorkspaceRestore(
  saved: RetailWorkspace, requestedDraft: string | null, createTab: () => RetailInvoiceTab,
): { workspace: RetailWorkspace; loadRequestedDraft: boolean } {
  if (!requestedDraft) {
    return { workspace: saved, loadRequestedDraft: false };
  }
  const existing = saved.tabs.find(tab => tab.snapshot?.loadedDraftId === requestedDraft);
  if (existing) return { workspace: { ...saved, activeTabId: existing.id }, loadRequestedDraft: false };
  const incoming = createTab();
  return {
    workspace: { tabs: [...saved.tabs, incoming], activeTabId: incoming.id },
    loadRequestedDraft: true,
  };
}
