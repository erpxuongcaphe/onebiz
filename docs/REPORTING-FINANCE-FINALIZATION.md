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
- Product/unit inventory movements, Vietnam dates, full-result export source and four-decimal display: PR516/517; production deployments verified.
- Customer catalog group codes and atomic customer allocation: 00437 and PR518. Production customer history digest unchanged; tenant customer count remains 106; no live customer created during verification.
- Complete cash-summary paging and stalled-export guard: PR519. Production deployment verified at commit 33a0391ba74dfea9be6ad47728d5b5347961e140; no SQL/business-data writes.

## Current implementation

- Replace mixed-unit daily stock totals with date/product/unit rows.
- Count in/out legs and signed adjustments; exclude transfer headers and unknown movement types.
- Use Vietnam business dates, stable created_at/id paging and existing tenant/branch/range restrictions.
- Chart one selected product, including zero-activity days. Table and Excel share the same rows.
- Unknown units remain explicitly unknown. This uses catalog units for presentation and does not manufacture historical unit or cost snapshots.
- No SQL migration or business-data writes in this report correction.

## Unresolved dependencies

Customer allocation is released. Existing customer codes stay unchanged. New external customers require a configured group; internal branch customers and singleton walk-in customers retain their explicit protocols. Group names/codes resolve separately in imports, and lookup pages all customers. PostgreSQL rollback, concurrent allocation and tenant guards passed in CI.

Expense recognition does not yet have an independent event/settlement ledger. Existing cash payments must not be silently reclassified as accrued expenses. Implement that source before calling the management P&L complete.

## Recognition implementation draft

The isolated management-recognition module is not connected to production reports or cash writes. It verifies recognition date independent of payment date, branch allocations that conserve the event total, partial/multiple settlements, outstanding amounts as of period end, duplicate source rejection, overpayment rejection and cancellation prerequisites. This is a tested calculation contract, not a released finance workflow.

Remaining gates in order:
1. Persist leaf categories, recognition events and settlement links with existing tenant/branch permissions, audit and idempotency.
2. Implement one form for immediate/partial/unpaid income and expense; use existing cash creation/cancellation rules, never duplicate cash or trade debt.
3. Build period and shared-branch allocation, reconciliation and explicit historical unclassified source lists.
4. Connect P&L, cash flow and category-detail tables to that source; drilldown/export must match totals, retaining missing-cost warnings.
5. Finish customer/day/invoice, purchase/XNT historical-cost and document drilldown acceptance; do not infer absent snapshots.
6. Run isolated DB, UI desktop/mobile, full CI, exact merge/deploy and production read-only verification before reporting completion.

## Verification record

- Local report/schema suite: 30 tests passed.
- PR516/517: full CI/build/PostgreSQL and production deployment passed; inventory table browser verified. Excel showed a success toast, but downloaded workbook contents were not independently read.
- PR518: TypeScript, service/schema tests, full CI/build and isolated PostgreSQL passed. Production form shows readonly KHA-KSI-... after selecting the wholesale group. No customer was saved to production for testing.
- PR519: TypeScript and 12 targeted service tests passed; full CI/build/PostgreSQL and Vercel production passed. Existing cash workspace uses its server-side summary; compatibility summary now reads complete results rather than silently truncating them.
