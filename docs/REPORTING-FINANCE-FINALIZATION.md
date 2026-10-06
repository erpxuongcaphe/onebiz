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

Expense recognition has an independent event/settlement ledger in merged PR520. Existing cash payments are not silently reclassified as accrued expenses. Production migrations are applied; browser acceptance and remaining cross-report gates are recorded below.

## Recognition implementation draft

The isolated management-recognition module is not connected to production reports or cash writes. It verifies recognition date independent of payment date, branch allocations that conserve the event total, partial/multiple settlements, outstanding amounts as of period end, duplicate source rejection, overpayment rejection and cancellation prerequisites. This is a tested calculation contract, not a released finance workflow.

Remaining gates in order:
1. Persist leaf categories, recognition events and settlement links with existing tenant/branch permissions, audit and idempotency.
2. Implement one form for immediate/partial/unpaid income and expense; use existing cash creation/cancellation rules, never duplicate cash or trade debt.
3. Build period and shared-branch allocation, reconciliation and explicit historical unclassified source lists.
4. Connect P&L, cash flow and category-detail tables to that source; drilldown/export must match totals, retaining missing-cost warnings.
5. Finish customer/day/invoice, purchase/XNT historical-cost and document drilldown acceptance; do not infer absent snapshots.
6. Run isolated DB, UI desktop/mobile, full CI, exact merge/deploy and production read-only verification before reporting completion.

## PR520 release record

- 00438: new leaf categories, branch/period allocations, guarded idempotent event posting, atomic immediate/partial payment through the existing cash context RPC, cancellation audit and complete paged workspace.
- 00439: narrow guarded change to existing P&L definitions; excludes linked cash settlements from historic cash expenses and adds recognized expenses/other income. No sales, stock or historic cash rows updated.
- New income/expense workspace and form; unpaid/immediate/partial payment, actor and cash timing, source allocation/settlement detail, server filters/sort, complete Excel source, category creation and guarded cancellation.
- Pending-request payload persisted before dispatch. Confirmed SQL rejection permits correction; uncertain network result retains the same request key. UI tests cover unpaid posting, uncertain retry and remount recovery.
- Final CI on 75a6bef4bf02dc728befe45ca6605f3c64dfdcc4 passed: 478 test files, 5,342 tests, production build, schema/database checks, isolated PostgreSQL and Vercel preview.
- Isolated ledger integration loads the real 00435 cash-context wrapper; its underlying timed money RPC is a test stub. Do not describe this as full live payment acceptance.
- User approved production 00438/00439 after CI success. Both migrations returned success on 2026-10-06. Before applying, two existing P&L definitions were saved in docs/evidence/finance-report-functions-before-00439.json.
- Production verification: ledger exists; linked-cash exclusion and recognition helper are present in P&L; branch report includes other income. Configuration categories total 280 across tenants; event count 0 and settlement count 0. No business documents were created for this verification.
- PR520 merged at 5c6cbe08c49302f88a0da46499ead09d2a3094dc. Vercel production Bu5Cm2LgaPNjWzrWL5DcCmYvhe6G is Ready/Current for onebiz.com.vn, with that exact source commit; browser deployment overview verified.
- Production browser: workspace loaded with empty ledger, category search/selection and new-document form verified. Immediate-payment mode exposes separate cash branch, performer, method, actual time and accounting date. No form submission occurred. P&L loaded including recognized other-income row; captured console error lists were empty for the workspace and P&L.
- Desktop screenshot saved in docs/evidence/finance-workspace-production-20261006.jpg; migration and deployment screenshots are in the same folder.
- Mobile acceptance is NOT passed: viewport.set requested 390x844 but DOM measurements remained 1280x720, including a fresh tab. Override reset; temporary tabs closed. Need a genuine mobile viewport before declaring responsive acceptance.
- Still required: genuine mobile browser verification, plus the remaining cross-report acceptance gates above. Cash-flow activity classification, explicit legacy-unclassified reconciliation and full detail/export acceptance are not declared complete. This PR does not finish the entire reporting center.

## Verification record

## Cash-flow and category reconciliation follow-up (not released)

- 00440 adds activity classification to the new management catalog only; known seed items receive an explicit policy (interest paid financing, deposit interest investing); other/custom or ambiguous historic sources remain unclassified. No historical cash, event, invoice, stock or debt rows are updated.
- Read-only cash-source RPC uses the actual paying branch and cash accounting date, independently of recognition allocations/date. Existing finance permission and complete-source branch guards apply; cancelled cash is excluded. New category creation writes its chosen activity and audit atomically.
- Cash-flow activity summary and source detail use the same complete cash document list as monthly totals. Each cash document counts once; recognized expense amounts are never added to cash totals. Unknown sources remain visible.
- Category view sums posted recognition amounts within the current filters, but labels whole-source settlement/outstanding separately rather than manufacturing branch-proportional payments. Excel follows the selected category/document view.
- P&L visibly identifies the retained legacy cash-expense subtotal and its old created-date basis. This is disclosure, not historical accounting reclassification or approval.
- Pending gates: isolated PostgreSQL/CI, exact production migration/release, downloaded workbook validation and real mobile viewport verification. No live test business documents are planned for this release.

- Local report/schema suite: 30 tests passed.
- PR516/517: full CI/build/PostgreSQL and production deployment passed; inventory table browser verified. Excel showed a success toast, but downloaded workbook contents were not independently read.
- PR518: TypeScript, service/schema tests, full CI/build and isolated PostgreSQL passed. Production form shows readonly KHA-KSI-... after selecting the wholesale group. No customer was saved to production for testing.
- PR519: TypeScript and 12 targeted service tests passed; full CI/build/PostgreSQL and Vercel production passed. Existing cash workspace uses its server-side summary; compatibility summary now reads complete results rather than silently truncating them.
