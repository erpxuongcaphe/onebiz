# F&B production with negative stock

The production form and posting functions previously rejected ingredients when branch stock was insufficient, even when the café physically had those ingredients. In addition, cost checks compared positive costed stock directly with physical stock and ignored the already recorded deficit.

For active outlet branches producing F&B stock items, an operator can confirm physical availability in the existing form and complete the batch. Changing ingredients, quantities, branch or recipe invalidates that confirmation. The confirmation and stock preview are recorded in the order notes. Actual input quantities still reduce stock, actual output is credited, and the existing atomic completion/replay guards remain in place.

Production cost checks reconcile `costed_quantity - deficit_quantity` with physical stock. Known branch unit costs remain the material cost snapshots. Deficits are linked through their cost event to the production order, without creating an invoice reference. Later receipts settle deficits through the established ledger and log actual-versus-estimated differences; completed production cost snapshots and old invoices are not restated.

Retail production and the separate negative-sales policy remain unchanged. Invalid units, missing/invalid material snapshots, permission failures, missing cost snapshots and unexplained physical/cost-ledger discrepancies still fail closed. This migration does not correct historical stock or complete an existing order.

## Validation

- UI tests cover explicit confirmation, reset after quantity edits, a recorded negative deficit, and unchanged Retail shortage blocking.
- `scripts/fnb-db-test/run-production-negative-stock-local.mjs <pglite/dist/index.js>` extends the real production/cost-function fixture. It reproduces -531g consuming another 240g to reach -771g while crediting 1,042g output; verifies branch cost, replay rejection, missing zero-stock rows, receipt settlement and permission denial.
- The database test applies the migration twice and verifies existing stock, cost balances and movement counts remain unchanged.

Deploy the migration before the UI: the new quantity-only stock-health RPC adds deficit quantity while retaining the existing RPC's authorization and branch checks. Function bodies are patched in place with fail-closed anchors; OIDs, grants and permission wrappers are preserved.
