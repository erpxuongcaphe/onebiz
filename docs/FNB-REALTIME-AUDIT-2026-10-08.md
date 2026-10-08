# F&B Realtime Audit - 2026-10-08

Scope: read-only UI refresh, no invoice, stock, BOM, payment or Retail data changes.

## Transactional Screens

| Surface | Finding | Change / status |
| --- | --- | --- |
| Unpaid orders and saved POS tabs | Only active tab reconciled | Released in PR564; all saved tabs checked against server proof |
| Table status and unpaid totals | Existing branch-scoped subscription with read generations | Retained |
| Kitchen display | Reconnection did not immediately refetch; missing focus/online recovery | Added guarded reconnect refresh and recovery listeners |
| POS invoice history | Loaded only on open/search; old requests could overwrite new search/branch | Added live refresh while open, request generations, cleanup; retain confirmed rows on background failure |
| Delivery count | Independent 60-second interval; late branch response could overwrite count | Follow kitchen-order events, visible-page fallback, branch/request guard |
| Current shift | Changed only on initial load/manual reload/network changes | Added read-only live getOpenShift refresh; no periodic overdue mutation |
| Floor-plan order timestamps | Independent 60-second query | Derived from the same confirmed unpaid snapshot as table totals |

## Remaining Acceptance Checks

- Verify production publication and RLS for invoices and shifts. A subscribed channel alone is not proof that a table emits changes.
- Kitchen-order events provide invalidation for F&B checkout; 30-second visible-page polling remains recovery, not an instant-update guarantee.
- Verify two-device invoice history, kitchen returns and shift closure with a cashier role, not only admin. No live transactions were created in this audit.
- General invoice list, report center, cashbook, inventory screens and catalog/price configuration have separate read paths. They are not all covered by the POS hook and must not be described as fully realtime based on this release.
- Do not publish invoice item/payment tables broadly or loosen RLS. Any additional database invalidation needs a scoped permission/publication review before production approval.

## Verification

Runtime tests cover branch-filtered invalidations, event coalescing, subscription/reconnection, focus/online/visibility recovery, hidden-page suppression, cleanup and disabled subscriptions. Source guards cover KDS recovery, history stale-result protection, delivery count, shift and shared table timestamps. End-to-end simultaneous real-device acceptance remains separate.
