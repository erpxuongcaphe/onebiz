import type { FnbTabSnapshot } from '@/lib/types/fnb';

/** Close only the acknowledged bill. Never discard changes made during its request. */
export function finishKitchenSubmissionTabs(
  tabs: FnbTabSnapshot[], tabId: string, activeId: string, fresh: FnbTabSnapshot,
): { tabs: FnbTabSnapshot[]; activeId: string } {
  const submitted = tabs.find(tab => tab.id === tabId);
  if (!submitted?.kitchenOrderId || submitted.lines.length > 0) return { tabs, activeId };
  const remaining = tabs.filter(tab => tab.id !== tabId);
  if (activeId !== tabId && remaining.some(tab => tab.id === activeId)) return { tabs: remaining, activeId };
  const empty = remaining.find(tab => !tab.kitchenOrderId && !tab.tableId && tab.lines.length === 0 && !tab.sentLines?.length);
  return { tabs: empty ? remaining : [...remaining, fresh], activeId: empty?.id ?? fresh.id };
}
