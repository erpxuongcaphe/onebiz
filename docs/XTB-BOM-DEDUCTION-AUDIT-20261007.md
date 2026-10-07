# XTB BOM deduction audit - 2026-10-07

Scope: authenticated read-only production reads for branch
`0dfc218e-0b32-4096-8205-d5f82ab42492`. No inventory, invoice, BOM,
shift, or Retail record was changed. This is a captured set, not a claim
about later sales while the shop continues operating.

## Captured evidence

- 21 completed F&B invoices, HD001709 through HD001732 (non-contiguous).
- 35 invoice lines and 35 associated kitchen lines.
- 99 outgoing `bom_consume` movements; 88 invoice/recipe/material groups.
- 14 active recipes matched by code or name, with 43 components.
- Aggregated component quantities match the stored recipes and selected
  modifier quantities in this captured set. No extra deduction is visible
  in this comparison. Identical movement notes can legitimately represent
  two separate portions, as on HD001714.
- Invoice line cost: 112,918.66 VND. Corresponding outgoing branch cost
  events: 112,918.66 VND, within currency precision, for every invoice.
- Previous baseline reconciliation: all 279 branch movements balance to
  the 44 captured branch stock rows; no negative stock was observed.
- HD001724 deducts 0.1067 stock units of SKU-BTP-002 for Cold Brew Cam.
  This is consumption of the stocked semi-finished product, not a second
  expansion of its coffee production recipe.
- No paid topping or linked-product modifier occurs in this captured set;
  that path is not certified by today's sales.

## Findings requiring configuration repair

### 1. No-sugar selection still consumes sugar

HD001714 has two Xuong Gu Viet Size M portions, including one with the
no-sugar option (scale factor 0). Both consume 0.006 kg sugar each.
The sugar component in `SKU-CAP-011-SIZEM` has a null
`modifier_scale_target`, so the consumer treats it as fixed.

Repair direction: explicitly link this sugar component to the intended
sugar modifier group. Preserve the coffee component and historical
movements. Do not automatically infer modifier targets from material names.

### 2. Six used recipes retain the old condensed-milk conversion

SKU-SUA-003 is named Lamosa 1000 gram/can. Its active conversion is now
1 can = 1000 g, created 2026-10-07T03:29:28Z. These stored BOM quantities
still reflect the previous 1400 g/can conversion:

| Recipe | Input grams | Stored cans | Cans at active conversion |
| --- | ---: | ---: | ---: |
| SKU-CAP-001-SIZEL | 50 | 0.0357 | 0.0500 |
| SKU-CAP-010-SIZEM | 24 | 0.0171 | 0.0240 |
| SKU-CAP-007-SIZEM | 42 | 0.0300 | 0.0420 |
| SKU-CAP-007-SIZEL | 60 | 0.0429 | 0.0600 |
| SKU-GKH-002-DA (accented production code) | 42 | 0.0300 | 0.0420 |
| SKU-CAP-014-SIZEM | 28 | 0.0200 | 0.0280 |

HD001732 illustrates the effect: 13.7 g coffee consumes 0.0137 kg,
but the stored 28 g milk input consumes 0.0200 can rather than 0.0280.

Repair direction: refresh the affected F&B recipe conversion snapshots
for future sales, with a scoped preview and audit. Do not modify shared
Retail conversions or silently recalculate historic stock/COGS.

### 3. Cold Brew batch conversion confirmed by owner

Owner clarification: one batch uses 100 g coffee and 1000 ml filtered
water, producing 750 g Cold Brew concentrate. The stock unit label
`Me/100g` refers to coffee input per batch, not 100 g finished output.
The active conversion of 750 g per stock unit is therefore correct.
An 80 g drink portion consumes 80 / 750 = 0.1066667 batches,
stored as 0.1067 at the current four-decimal posting precision.
Do not change this conversion to 100 g per unit or rescale stock.

Read-only follow-up confirmed active BOM `BOM-SKU-BTP-002`:
batch_size = 1, yield_qty = 1, with 100 g coffee represented by
0.2 bags of 500 g coffee. Its legacy yield_unit is `cai`, but the
production dialog resolves prepared-product output to the product's
stock unit. Only the coffee component is currently stored; water and
brewing instructions are not present in the BOM note.

UX direction: display one batch with an explicit 750 g finished yield
and 100 g coffee / 1000 ml water instructions. A future label cleanup
must preserve stock-unit identity and all existing conversion links.
Water should become a stock-consuming component only if the shop
actually tracks its inventory; do not add a fictional water SKU.

Production cost posting uses actual consumed component cost divided
by completed stock-unit quantity. One completed batch consequently has
the batch cost; drink consumption then uses its fraction of that cost.
There are no captured XTB production orders, so this production path
was inspected in code, not certified by an actual completed batch today.

## Acceptance conclusion

The captured posting and cost-conservation path works according to stored
configuration. Operational BOM correctness is not fully accepted because
the no-sugar mapping and stale milk conversion need correction. Do not
describe this as fully correct merely because invoice and ledger totals match.

## Authorized configuration repair

Owner authorized repair in the next turn. Seven exact F&B component rows
were updated using the existing authenticated BOM write path, conditional
on their captured IDs, BOM/material IDs, quantities, input units, factors,
and modifier targets. All seven were read back and verified on
2026-10-07T13:59:36Z.

- Six milk components were renormalized by the existing database trigger
  from their unchanged input grams using the active 1000 g/can conversion.
- Gu Viet Size M sugar was linked explicitly to its existing sugar group.
- Cold Brew BOM notes now describe 100 g coffee + 1000 ml filtered water
  producing 750 g concentrate per batch. Batch size, yield and conversion
  were not changed. Its previous note was null.
- A backup of all seven old component rows is in
  `XTB-BOM-CONFIG-BACKUP-20261007.json`.
- These recipe headers are shared F&B recipes, not XTB-only overrides;
  the correction applies to other F&B outlets using those same recipes.
- Read-back of the captured 35 invoice lines found zero quantity/cost
  changes, with historical line cost still 112,918.66 VND. No historical
  stock corrections, refund, purchase, shift or Retail write was issued.

This verifies configuration repair, not a new live checkout: no new
production invoice was created to test it.

## Unit-entry UX scope

Reference: KiotViet official F&B store setup and retail product guides
describe multiple transaction units tied to a base unit.
https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/fnb-thiet-lap/thiet-lap-cua-hang/
https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-lam-quen-voi-kiotviet/buoc-1-them-moi-hang-hoa/

- Purchase entry already selects direct/reverse related units. Existing
  server-side normalization and transaction quantity/price/factor snapshots
  remain unchanged; do not implement a second client-side posting conversion.
- Inventory check now retains packaging-plus-remainder entry and allows
  direct entry in any unambiguous active unit linked to the stock unit.
  Unit changes preserve counted stock quantity. Only canonical quantity
  is sent to the existing atomic inventory-check RPC.
- Inventory quantity display retains four decimals so small amounts do
  not display as zero. Conversion-loading failure is explicit.
- BOM editor warns when stored component quantity differs from current
  conversion, requiring review/save for subsequent sales.
- Disposal and transfer workflows still require a separate end-to-end
  unit-entry audit. Their schemas/posting were not changed in this release.
- The other chat owns opening-stock work; no opening-stock edit was made.

Owner clarified this request concerns F&B. The new count-unit selector is
limited to outlet branches (`branchType = store`, the existing outlet
classification), not warehouse/factory/office branches. Warehouse packaging
entry and four-decimal input remain unchanged. There is no separate F&B vs
Retail store discriminator in the current Branch type; this does not
hard-code XTB or reclassify branches. A UI regression test verifies warehouse
entry still posts 24.5 canonical units without a new selector.
