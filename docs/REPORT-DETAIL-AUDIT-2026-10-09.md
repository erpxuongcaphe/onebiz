# Report Detail Audit - 2026-10-09

## Scope of this release

- End-of-day: table-first daily sales, invoice counts, quantities, invoice value,
  returns in the period, value after returns, invoice-linked paid/debt amounts.
- Separate hourly and top-20 quantity tables. Top products are not the complete
  SKU revenue report and quantities have not been netted against returns.
- Payment-method amounts remain invoice values, not cash-ledger movements.
  Names now make that distinction explicit. Mixed/wallet values also appear
  in the chart; they are not inferred allocations to cash/card/transfer.
- Existing authorized daily RPC reused; no migration or business-data writes.
- Existing sales table can group days into Monday-based weeks or calendar
  months. Partial periods and drilldowns remain bounded to the selected range.
- Current-view Excel and controlled table sort share the same source rows.
- End-of-day stale request responses are discarded; errors clear prior results.

## Acceptance

- Unit cases: Monday/Sunday boundaries, year boundary, leap month, partial week,
  return-only negative day, additive metrics, input immutability and export wiring.
- Required: TypeScript, lint, CI, Vercel preview, merge and production verification.
- Production checks are read-only. Do not produce artificial business documents
  or change Retail stock to make a report look populated.

## Still not accepted as complete

1. Complete SKU revenue detail: code, name, unit/variant, sold and returned
   quantities, discounts, net revenue, historical COGS, gross profit/margin,
   group/channel/customer/staff filters, invoice-level drilldown and Excel parity.
2. Cash movements: reconcile receipts/refunds/payments by their transaction date,
   branch and method, independently from invoice revenue and accrued expenses.
3. Whole-center audit: customer, employee, branch/channel, inventory and profit
   pages need individual source/filter/sort/export acceptance, not a blanket signoff.
4. Actual numerical reconciliation against existing Kho Tong and XTB documents.
5. Top-product service aggregates by product name. It is suitable only as a
   labeled quantity ranking, not as a SKU-level financial report.

## Reference direction

- KiotViet end-of-day organizes sales, receipts/payments and goods separately:
  https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/huong-dan-bao-cao/bao-cao-cuoi-ngay/
- MISA highlights cross-branch/period comparisons and separate sales returns:
  https://help.amis.vn/V2/amis_act_bo_sung_bao_cao_phan_tich_chi_tiet_doanh_thu_theo_nhieu_chi_nhanh_va_chi_tiet_doanh_thu_theo_nhieu_ky.htm

Opening inventory functionality belongs to the other chat. Do not modify it here.
