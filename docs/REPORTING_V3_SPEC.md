# Reporting V3 specification

This document is the contract for OneBiz analytical reports. It applies to the
web view, drill-down data, Excel exports, and server-side report functions.

## Report scope

- `branch=<uuid>` means one accessible branch.
- `branch=all` means the consolidated tenant view and requires
  `reports.view_all_branches`.
- A user without that permission is forced to an accessible branch. Job title is
  never an authorization source.
- Consolidated totals must be computed from transaction rows, not by summing
  already-rounded branch percentages or averages.

## Canonical measures

- Gross sales: completed invoice line value before invoice-level discounts and
  returns.
- Net revenue: completed invoice total after discounts, less the full economic
  value in `sales_returns.total`. `sales_returns.refunded` is only the cash
  portion and must not be used as the revenue reversal.
- Delivery fee remains unchanged on a product return until the data model records
  a dedicated delivery-fee refund; reports must not fabricate a proportional
  delivery refund.
- COGS: quantity multiplied by the cost snapshot captured on the invoice line.
  Legacy rows without a snapshot use current product cost and must be labelled
  `estimated` in detail exports.
- Gross profit: net revenue minus COGS.
- Operating expenses exclude inventory purchases and refund cash movements so
  returns are not deducted twice.
- Operating result: net revenue minus COGS minus operating expenses. It must not
  be labelled accounting net profit until tax, depreciation, and financial
  adjustments are represented.
- Customer first purchase is the first completed purchase in all available
  history, not merely the first purchase inside the selected report period.

## Export contract

Every full report export must include:

1. An `Information` sheet with tenant (when supplied), report, branch scope, period, timezone,
   generated time, user (when supplied), interpretation notes, and cost basis
   where relevant.
2. A `Summary` sheet matching the visible KPI totals.
3. A complete detail sheet for the selected scope and period where a detail
   data set exists. A top-N chart is never a full export.
4. Stable column names, IDs/codes where available, and raw numeric/date cells so
   accounting users can pivot and reconcile them.

## Security and performance

- Client filters are UX only. Report RPCs must derive the actor from `auth.uid()`
  and verify tenant, effective permission, and branch access.
- Aggregation over business transactions belongs in SQL/RPC. It must not depend
  on the Supabase client default row limit.
- Independent reads run in parallel and stale client requests are abortable.
- Core reports must reconcile to source transactions before production rollout.
