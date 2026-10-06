# Product revenue and cash detail increment

## Implemented scope

- Allocate invoice-level discount after subtracting line discounts already included in the stored header. Allocate across the full invoice before limiting or filtering products.
- Keep product quantities separate by unit; show sold, returned and net quantities. Do not sum mixed-unit quantities in the table or export footer.
- Use reconciled revenue for the product chart; do not present unverified return amounts as zero. Table is the default view.
- Add category and sold/returned activity filters and preserve the displayed product subset in Excel exports.
- Fetch product invoice lines in stable ID order across pages; keep existing tenant, branch, date and completed-invoice scope.
- Add creator and actual cash timestamp to cash-flow detail and Excel. These fields do not identify the employee who actually handled cash.

## No business-data mutation

This increment contains no SQL migration or write to business records. It does not change checkout, stock, debt, receipts or historical document codes.

## Remaining finance requirements

Every income/expense recognition and payment must identify its branch and related party. Capture the actual collector/payer separately from the authenticated creator, with business date, actual cash timestamp, category, method/account, original document, status and audit history. Never label the creator as the actual payer without evidence.

Income/expense recognition and its payments must be linked so that settling a payable or receivable does not count income/expense twice. Shared costs require a conserving branch allocation, not duplication across branches. Historical missing identity/timing data must be explicitly marked, not guessed.

## Remaining reporting scope

This increment does not complete all five report workstreams. Customer-code generation, expense hierarchy and recognition, complete financial/cash-flow reconciliation, purchasing/warehouse detail, and source-document drilldown remain separate acceptance gates. Invoice-code backend migration 00433 remains unapplied until its production SQL execution is verified.

Return unit is optional in the existing RPC response. Ambiguous units are retained as an unmatched row rather than converted without evidence. Product category is current master data, not a historical category snapshot. Actual refunds belong to cash reports; return value belongs to sales reconciliation.
