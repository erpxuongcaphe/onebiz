# Management report acceptance matrix

This is a source review, not a blanket numerical acceptance of the report center.
Production verification must use existing authorized documents; no inventory or
opening balances are changed in this work.

| Report | Source review | Remaining acceptance |
| --- | --- | --- |
| Inventory movements (XNT) | Historical values, branch/date/search/category/unit filters, meaningful same-unit quantity totals, controlled sort and filtered Excel exist. This release adds four quantity/average-unit-value/amount groups and keeps code first. | Compare actual document totals and missing historical values; movement-type breakdown currently has quantities only, not historical amount per bucket. |
| End of day | Daily/hourly amounts, returns, invoice paid/debt, scoped drilldowns and sorted Excel implemented in PR576. | Cash by actual receipt/refund date is distinct from invoice method. Complete SKU profitability is not the top-20 quantity ranking. |
| Sales periods | Daily/weekly/monthly additive values and bounded drilldowns verified. | Document-level reconciliation; do not sum heterogeneous quantity units as an inventory measure. |
| Customer/product | Product codes, units, revenue, quantity and customer selection exist; server-paged detail requires one customer. | Add authorized all-customer SKU aggregation; return/discount/historical COGS/margin details; customer picker must not silently rely on the current customer page only. |
| Inventory overview | Revenue ranking, returns reconciliation and stock charts exist. | A ranking is not a complete all-SKU ledger. Full SKU financial detail and filters must be independently implemented. |
| Material consumption | Branch/material quantities and amounts from consumption RPC exist. | All-column sorting, code-first structure, search/unit filters and shared filtered Excel; prove missing costs are not collapsed to zero before displaying unit values. |
| Finance/profit | Trend/expense tables have controlled sorting. | Verify recognition date versus cash date and historical cost completeness against source documents. |
| Cash flow | Transaction/category/method/amount/date/object/branch/person filters and sorting exist. | Reconcile source transactions and filtered exports; do not equate invoice payment-method totals with ledger cash. |
| Staff | Table and source dimension exist. | Verify that visible table ordering is passed to Excel and that quantity/customer totals have valid meanings. |

## Inventory workbook contract

- One product per vertical row; code is text, first and always visible.
- Opening, receipts, issues, closing each have quantity, average unit value, amount.
- Average unit value is historical amount / quantity. It is a descriptive ratio,
  not a change to FIFO/weighted-average valuation or an individual document price.
- No unit price when quantity is zero or historical value is missing. Amounts
  remain visible independently; unit prices are not summed in totals.
- Mixed-unit quantity totals remain blank; known monetary totals stay separate.
- Current-view export follows active rows/sort/visible columns. Full export
  includes all columns for the same active row scope and records parameters.
- Excel AutoFilter excludes report titles and subtotal/signature rows.
- Quantity and average unit value display supports four fractional digits;
  exported source numbers are not rounded to that display precision.
- Customer filtering belongs to sales analysis or explicitly scoped movements;
  it must not redefine whole-branch opening/closing inventory.

## References

- MISA average receipt/issue/stock unit values:
  https://helpasp.misa.vn/accounting/kb/cai-tien-bao-cao-tong-hop-ton-kho-bo-sung-cot-don-gia-binh-quan-nhap-xuat-ton-de-khach-hang-de-dang-theo-doi/
- KiotViet report domains:
  https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-bao-cao/bao-cao/

Opening inventory is owned by the parallel chat and is explicitly excluded.

## SKU And Material Detail Release

- New `/phan-tich/sku-chi-tiet` report has all-customer or selected-customer
  scope, product code/name/category/unit filters, source-value sorting and
  filtered Excel exports. It separates sales, returns, net revenue, historical
  COGS and gross profit; invoice discounts are allocated to product lines.
- Sales use invoice issue time, returns use return-document time. A return in
  a later period remains visible without requiring a sale in that period.
  Zero-price sales retain their inventory cost and resulting gross loss.
- Material consumption now uses the exact branch cost event, or the historical
  stock-movement cost outside branch cost tracking. Current product cost is not
  a replacement for a missing snapshot. Missing monetary totals remain null.
- Both tables keep code first, expose unit quantities and average unit values,
  and use the same filtered/sorted row source for display and Excel. Quantity
  totals are not added across heterogeneous units. Unit prices are not summed.
- Local validation: 257 existing report/Excel tests passed; two static guard
  checks were corrected and rerun with the six new data tests (12/12 passed).
  TypeScript passed. Disposable PostgreSQL fixture checks historical values,
  missing costs, discounts, dates, permission/customer scope and returns.
- Migration `00461_report_stock_and_sku_snapshots.sql` is approved for production
  after tests, but has NOT been applied at this checkpoint. Codex browser runtime
  fails to initialize and the Supabase CLI session is invalid. Do not merge the
  new report route into production until the reporting RPC exists and is verified.
- Actual source-document reconciliation and new-page browser/Excel acceptance
  remain pending. This release does not resolve missing opening inventory costs
  or certify all report-center financial values.

## Whole-center source screening

All 37 report-route page files were screened for table/export/search/sort/request
guard wiring. This is not browser or financial acceptance: shared components can
provide some controls even when the page has no local implementation. Priority
manual checks remain material consumption, BOM COGS, FNB, returns, VAT, aging,
staff, suppliers and channels. No page is marked complete merely because it has
an export button or a table. Verify authorization, full-row source coverage,
date semantics, meaningful quantities, nullable costs, filter/sort/export parity
and source-document drilldown separately for each report.

## Shared report UX release

- PR581 replaces the report-center workflow blocks with permission-filtered
  category navigation, readable report names, search, favorites and recent views.
- Both report-table implementations now share a bounded scroll viewport and
  a synchronized bottom horizontal scrollbar. Headers stay inside the viewport;
  simple tables default to a pinned first column. Existing preferences remain.
- Legacy nested overflow containers are flattened within the report scope only.
  Merged subtotal cells are not pinned across the whole table.
- This is a presentation change, not acceptance of missing SKU financial detail,
  historical costs, customer aggregation or Excel source reconciliation.
