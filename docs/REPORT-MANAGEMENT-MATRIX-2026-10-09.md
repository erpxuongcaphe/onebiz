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
- Customer filtering belongs to sales analysis or explicitly scoped movements;
  it must not redefine whole-branch opening/closing inventory.

## References

- MISA average receipt/issue/stock unit values:
  https://helpasp.misa.vn/accounting/kb/cai-tien-bao-cao-tong-hop-ton-kho-bo-sung-cot-don-gia-binh-quan-nhap-xuat-ton-de-khach-hang-de-dang-theo-doi/
- KiotViet report domains:
  https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-bao-cao/bao-cao/

Opening inventory is owned by the parallel chat and is explicitly excluded.
