# F&B paid report selection repair

## Production evidence

Read-only XTB reconciliation on 2026-10-07 found two paid invoices whose kitchen orders remained served: HD001709 / KB000046 (65,000 VND) and HD001725 / KB000063 (47,000 VND). Invoice status, not kitchen preparation status, determines recognition in paid revenue reports.

The corrected authenticated PostgREST query returned HTTP 200, 21 orders, invoice total 863,000 VND, including both served orders. No business data was changed. Daily P&L V2 and receipts independently matched 863,000 VND; invoice-line COGS matched 112,918.66 VND. All 279 branch movements reconciled with 44 branch stock rows, without negative stock.

## Scope

- Menu, table, order-type, delivery-platform, product-category and modifier reports select completed F&B invoices regardless of kitchen status.
- Menu and modifier period filters follow invoice ngay_chung_tu, consistent with table revenue and financial recognition.
- Draft, cancelled and Retail invoices are excluded; tenant and branch scope and pagination remain intact.
- Monetary aggregation, refunds, discounts, operational turnover metrics and checkout are not changed by this repair.
- No SQL migration, stock mutation, invoice mutation or shift closure.

## Multi-device audit boundary

Existing shared-order selection excludes invoice-linked orders. Existing realtime invalidation has visible-page polling every 30 seconds and focus/online/visibility refresh. Existing payment wrapper locks the kitchen order and uses idempotent replay for linked invoices. Relevant isolated regressions are included in verification.

This is not a physical two-device payment-race certification. A background/offline phone may retain an older snapshot until reconnect/focus; payment safety must remain enforced server-side. No payment was attempted against the user's real completed bills.

## Regression coverage

New behavior tests exercise paid served orders across all six reports, exclusion of drafts/cancellations/Retail/other branches/other tenants, and invoice-date filters. Existing drill-down contract now requires completed invoice status rather than kitchen status.

Remaining whole-system acceptance gates (physical multi-device, employee sessions, actual completed BTP production, physical printer and all report Excel/filter combinations) are not declared complete by this scoped release.
