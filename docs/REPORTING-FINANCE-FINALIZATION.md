# Reporting and finance finalization

## Scope and release gates

This is one consolidated backlog, not a statement that every report is finished.
Existing Retail documents, stock, costs, codes and cash history must not be rewritten.
Changes in parallel chats must be reviewed before merging; do not stage the shared checkout.

| Group | Remaining delivery | Acceptance |
| --- | --- | --- |
| Customers | Required catalog group; atomic group-based codes; full form, POS, import and API paths; explicit internal/walk-in exceptions | Concurrent creation unique; old codes unchanged; no cross-tenant group; failed creation rolls back allocation |
| Income and expense | Leaf categories with management codes; business recognition independent of cash settlement; source document and branch; partial/multiple payments | Linked settlement never records the income/expense a second time; cancelled payments and documents reconcile |
| Branch management | Actual performer, creator, counterparty; branch allocation for shared expenses | Cash performer already released via 00435 and PR514/515; shared expense allocations still pending; chain total counts original once |
| Detailed reports | Sales by customer/product/day/invoice; XNT/purchases; filters, sorting, drilldown and matching export | Net sales reconcile returns; quantities keep product/unit dimensions; missing historical costs are not invented |
| Management finance | P&L by business period; cash flow by actual payment time; opening/closing cash, liabilities and advances | Separate revenue from receipts and expense from payments; reconcile each total to source rows; not a statutory accounting suite |

## Already released: do not repeat

- Invoice collision guard 00433 plus helper ACL 00436, verified read-only in production.
- Product sales discounts/returns, table view and product filters: PR512.
- Required cash performer with tenant/branch permission checks: migration 00435 and PR514.
- Human-readable cash picker labels: PR515.

## Current implementation

- Replace mixed-unit daily stock totals with date/product/unit rows.
- Count in/out legs and signed adjustments; exclude transfer headers and unknown movement types.
- Use Vietnam business dates, stable created_at/id paging and existing tenant/branch/range restrictions.
- Chart one selected product, including zero-activity days. Table and Excel share the same rows.
- Unknown units remain explicitly unknown. This uses catalog units for presentation and does not manufacture historical unit or cost snapshots.
- No SQL migration or business-data writes in this report correction.

## Unresolved dependencies

Customer creation currently permits client-generated codes. Imports update by existing code and map groups by name; internal branch customers and the POS walk-in customer have separate creation paths. Do not install a blanket mandatory-group trigger until these paths and their exceptions are covered by isolated PostgreSQL tests.

Expense recognition does not yet have an independent event/settlement ledger. Existing cash payments must not be silently reclassified as accrued expenses. Implement that source before calling the management P&L complete.

## Verification record

- Local report/schema suite: 30 tests passed.
- TypeScript, full CI, production deployment and browser verification must be recorded after completion; local tests alone are not production acceptance.
