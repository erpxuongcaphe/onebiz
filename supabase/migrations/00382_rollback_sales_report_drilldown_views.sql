begin;

revoke all on function public.get_sales_report_daily_rows(timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
drop function if exists public.get_sales_report_daily_rows(timestamptz, timestamptz, uuid);

revoke all on function public.get_sales_report_invoice_detail_page(
  timestamptz, timestamptz, uuid, integer, integer
) from public, anon, authenticated;
drop function if exists public.get_sales_report_invoice_detail_page(
  timestamptz, timestamptz, uuid, integer, integer
);

commit;
