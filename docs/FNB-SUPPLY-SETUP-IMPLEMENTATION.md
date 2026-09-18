# F&B supply setup implementation

## Non-negotiable inventory boundaries

- Retail inventory belongs to NVL. Retail sells SKU and consumes its NVL BOM.
- F&B receives Retail SKU and holds that SKU at the receiving branch.
- A menu BOM consumes those SKU balances in the F&B branch only.
- A shared NVL source does not establish equivalence between two Retail SKUs.
- No automatic box/carton substitution, price substitution, or historical rewrite.
- F&B recipe cost uses Retail sales price; stock valuation remains a separate concern.

## Delivery checklist

- [x] Isolate implementation in a clean worktree based on current origin/main.
- [x] Remove menu SKUs from generic internal-sale search; preserve existing NVL transfers.
- [x] Remove misleading global product stock from this selector.
- [x] Add tenant-scoped search, cancellation, explicit loading/error states.
- [x] Draft catalog UI, additive bulk assignment, removal, service and migration written.
- [x] Run the approved production migration `00386` and verify its structure, RLS, grants and RPC execution boundary. No product, inventory, financial or Retail data was written.
- [ ] Activate branch-approved catalog enforcement after reviewing existing usage.
- [ ] Bulk setup from current Retail SKUs and existing F&B BOM usage.
- [ ] Integrate catalog into recipe selection and internal supply on enabled branches.
- [ ] Audit source shipment/destination receipt timing before changing document flow.
- [ ] Verify Retail SKU sales history separately from F&B stock card.
- [ ] Finish preview UI checks and controlled activation at Xuong Tu Bua.
- [ ] Advanced SKU conversion document, only after explicit equivalence approval.

The search patch is groundwork, not completion of the catalog feature. Migration
`00386` has been applied after approval and structurally verified in production;
it created only the catalog/audit tables and RPC. No production inventory,
financial document, Retail product, Retail BOM, price or stock data was written.

## Draft catalog delivery

Route: `/hang-hoa/hang-cap-fnb`. Migration: `00386_fnb_supply_catalog_draft.sql`.
The screen explicitly says draft; saving does not enable transaction enforcement.
Editing requires BOTH `products.edit` and `system.manage_branches`, plus access to
every selected branch at the RPC. Reading requires product view and branch access.
The server derives tenant and actor, rejects NVL/menu/inactive SKUs on add, records
only changed links in its audit table, and denies direct browser table writes.
Removal permits inactive records so stale assignments can be cleaned up.

Use additive assignments, not whole-list replacement: another manager's changes
cannot be erased by a stale form. SKU and unit remain visible in search and review.
Existing Retail product metadata is only read. No default assignment or backfill.

Before enabling enforcement, exercise explicit permissions, cross-tenant IDs,
inaccessible branches, retries, concurrent add/remove, and verify the actual UI
at desktop/mobile sizes. The read-only SQL check file verifies structure and
grants; it does not prove business behavior.

## Setup UX and ownership

One central supply screen must reuse products, prices and units, not duplicate
them. Each row identifies a specific Retail SKU and packaging, allowed F&B
branches, recipe usage and readiness. NVL source is read-only derived information
from the Retail BOM, potentially containing multiple lines.

Administrators select existing SKUs, review unit conversions, and select F&B
stores in bulk. The screen shows `store` branches by default; warehouse, office
and factory branches require an explicit reveal and retain their type label. This
is a UX guard only, not server-side F&B activation inference. A newly created
Retail SKU is not silently enabled everywhere.
The same setup must be accessible from a recipe's component picker without losing
the unsaved recipe. Zero inventory must not prevent recipe setup.

Do not infer F&B from branch_type=store or cascade_mode=outlet. The activation
policy needs an explicit, permission-controlled scope before server enforcement.
Existing generic internal sales remain valid outside that scope.

## Supply and receiving

Reuse existing requests and internal sales where present. A destination request
must preserve SKU ID, unit, quantity and document lineage through shipment and
receipt. Ordinary Retail customer sales must not acquire F&B catalog restrictions.

If a recipe uses SKU-SUA-001 and a supplier offers SKU-SUA-002, show the mismatch.
Do not change invoice lines or debt to conceal it. Physical packing of 12 boxes
does not make a box-priced sale the same as a carton-priced sale.

No new receipt posting can be added until the current atomic internal-sale RPC's
destination posting is traced. Otherwise the same delivery could increase stock
twice. Partial receipts, retries, cancellations and reversals need explicit tests.

## Cross-check gates

1. Tenant and branch isolation; direct RPC permission denial for unauthorized users.
2. Existing NVL transfers and Retail BOM consumption unchanged.
3. Enabled F&B supply cannot include menu SKUs or unauthorized components.
4. Box and carton remain distinct through selection, pricing, receipt and reports.
5. Unit factors explicit, positive and compatible; no mass/volume inference.
6. Closed dialogs and older searches cannot overwrite newer results.
7. Repeat submit cannot double-post; reversal follows original quantities and value.
8. No production test documents without exact scope and baseline verification.

## Reference patterns

- Restaurant365 purchased/vendor item mapping: separate procurement packaging
  from recipe units; not justification to merge existing OneBiz SKU balances.
  https://docs.restaurant365.com/docs/vendor-items-vs-purchased-items
- Odoo units of measure: conversions belong to an explicitly configured item.
  https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html
- Oracle issue requests and transfer/acceptance: explicit document lifecycle.
  https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_requests_issue_request_and_transfer_process.htm
