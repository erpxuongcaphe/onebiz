# Invoice code allocation release

## Product rule

- Keep `HD` followed by a minimum of six digits: `HD001699`, then `HD001700`.
- One series per tenant, shared by Retail and F&B. No branch/year/shift reset.
- Date and branch remain separate invoice fields. Code order is allocation order, not a guarantee of business-date order for backdated documents.
- Preserve all historical codes, including cancelled and imported outlier codes. Do not reuse cancellations or resequence history.
- Internal invoice codes are not statutory electronic-invoice numbers.

## Backend change

Migration `00433_invoice_code_collision_guard.sql` adds an owner-only allocator called by the existing `next_code` invoice branch. All non-invoice branches are preserved using a guarded definition patch. The allocator locks the existing counter, tests exact occupied codes, advances within the existing series and does not synchronize to an imported outlier's maximum. Attempts are bounded at 1,000 and use non-retrying business errors. More than six digits are preserved instead of truncated by `lpad`.

No migration updates invoices, stock, payments, debt or existing counters. A missing invoice-series row is initialized only when the allocator is called. Existing checkout transactions roll back the counter if checkout fails. Do not call allocation separately to preview a number.

## Verification and deployment

PostgreSQL CI tests cover first code, tenant isolation, occupied/cancelled code, outlier preservation, seven-digit formatting, rollback, unchanged cash/order series, bounded collisions and invalid-series rejection. Apply twice to verify idempotency. Before production, verify the existing `next_code(uuid,text)` definition matches the guarded patch and save its definition. Stop rather than overwrite an incompatible concurrent change.

Merge and Vercel deployment do not apply SQL to Supabase. Record backend application and post-application read-only verification separately. Do not allocate a production invoice code solely for a smoke test.

## Financial-report scope

OneBiz remains sales/operations management. Prioritize business-date-aware P&L, actual-date cash flow, detailed expense/other-income reports, cash/bank reconciliation, receivables/payables/advances and inventory/COGS. General ledger, formal account charts and statutory financial statements are deferred. No claim of complete statutory accounting based on management KPIs.
