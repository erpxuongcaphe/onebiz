# Reporting V4 - Audit and Delivery Contract

## Scope

Reporting V4 covers all 36 routes registered in `src/lib/reports/catalog.ts`. The existing route structure and OneBiz services remain the source of truth; the work does not mutate production data.

## Mandatory contract for every report

- Uses `ReportPageHeader` for report title, company/branch scope, date range and export actions.
- Reads branch scope from `useBranchFilter()`; no second branch selector or title-based access checks.
- Provides an Excel export. Full exports carry an Information sheet plus summary/detail sheets where the report has multiple dimensions.
- Uses real branch names in screen/export metadata.
- Initializes every Recharts `ResponsiveContainer` with a stable dimension.
- Shows truthful loading, empty and error states; no unfinished placeholder cards.
- Keeps formulas aligned with `docs/REPORTING_V3_SPEC.md`.

## Route matrix

| Group | Routes |
| --- | --- |
| Executive | `/phan-tich`, `/phan-tich/cuoi-ngay`, `/phan-tich/tong-hop-kenh`, `/phan-tich/canh-bao`, `/phan-tich/doi-chieu-ca` |
| Sales | `/phan-tich/ban-hang`, `/phan-tich/dat-hang`, `/phan-tich/kenh-ban`, `/phan-tich/khuyen-mai`, `/phan-tich/tra-hang`, `/phan-tich/platform-commission` |
| Customers | `/phan-tich/khach-hang`, `/phan-tich/khach-san-pham`, `/phan-tich/customer-cohort`, `/phan-tich/rfm` |
| Inventory | `/phan-tich/xuat-nhap-ton`, `/phan-tich/hang-hoa`, `/phan-tich/abc-analysis`, `/phan-tich/lot-traceability`, `/phan-tich/kiem-ke`, `/phan-tich/chenh-lech-kiem-ke`, `/phan-tich/aging`, `/phan-tich/ton-that`, `/phan-tich/tieu-hao-nvl`, `/phan-tich/cogs-theo-bom` |
| Finance | `/phan-tich/tai-chinh`, `/phan-tich/bao-cao-tai-chinh`, `/phan-tich/luong-tien`, `/phan-tich/vat`, `/phan-tich/cong-no-aging` |
| Operations | `/phan-tich/fnb`, `/phan-tich/fnb-shipper`, `/phan-tich/fnb-modifier`, `/phan-tich/serve-time`, `/phan-tich/nhan-vien`, `/phan-tich/nha-cung-cap` |

## High-volume data contract

- PostgREST sources fetch every page instead of relying on the default row cap.
- Large related-ID lookups are split into bounded chunks.
- Primary sales, profit-and-loss and customer-product paths use migrations 196-198; direct-query fallbacks remain branch/date scoped.
- Full Excel exports request the complete scoped dataset, while view exports only export the current on-screen result.
- Release verification is read-only and never creates, edits or deletes production business records.

## Data and accounting boundary

The current financial views are management and operational reports built from invoices, payments, expenses, inventory and branch data. OneBiz does not yet expose a complete double-entry general ledger/chart-of-accounts foundation in this codebase, so these reports must not be represented as statutory accounting statements. Trial balance, balance sheet and statutory cash-flow reports require a separate ledger project and reconciliation migration.

## Release gates

1. Static 36-route contract tests pass.
2. Focused report tests and full Vitest suite pass.
3. TypeScript, ESLint and Next production build pass.
4. Staging UAT verifies all-company and single-branch views, export metadata and permissions.
5. Production deploy is followed by Chrome QC for all 36 routes without writing business data.
