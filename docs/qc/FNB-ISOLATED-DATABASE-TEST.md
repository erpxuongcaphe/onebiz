# Isolated F&B database checks

This suite runs on a fresh PostgreSQL 17 GitHub Actions service, not Supabase
production. No secrets or production exports are used. All identifiers and stock
are synthetic. A second synthetic warehouse is the branch-isolation control.

Run the **FNB isolated database acceptance** workflow. The runner accepts only
localhost port 55432, database `onebiz_fnb_test`, user `fnb_test`. It refuses an
existing products table. The service is discarded after the job.

## Coverage

- Actual migration bodies: consume_bom_for_sale, get_active_bom_for_branch,
  upsert_branch_stock, increment_product_stock, allocate_lots_fifo.
- M/L recipes, four exact sweetness amounts, zero sugar, two-cup multiplication.
- Display labels and fallback factors do not override exact amounts.
- Branch stock, aggregate product stock, FIFO allocations, movement ledger.
- Missing selection and insufficient stock roll back earlier material writes.
- Other warehouse remains unchanged; branch-specific recipe lookup.
- Actual open/close shift functions from migration 00298.
- Repeated shift opening is idempotent; invalid cash and branch access are blocked.
- Shift close calculates expected cash, net sales by payment method and completed
  invoice count, while excluding cancelled cash transactions.
- A cashier cannot close another cashier's shift without an explicit management
  permission, and a closed shift cannot be closed again.

## Limitations and remaining acceptance

The schema is a minimal SQL contract fixture. Tenant settings are a test adapter
that disables negative stock. This is NOT a full migration installation, RLS,
permissions, concurrency, purchasing, transfer, checkout, kitchen, refund or
browser acceptance test. Shift lifecycle is covered as a database contract, not
as a browser flow. A passing result cannot certify all F&B.

Next: build a separate full Supabase test environment before browser transactions.
Verify its database identity before importing synthetic fixtures. Preview URLs
alone do not prove isolation. Never use live central warehouse stock for tests.
Then test purchasing/receiving, POS payment, void/refund and reconciliation, using
the actual transaction RPCs and checking their ledgers. No production migrations
or stock changes are required for this focused suite.
