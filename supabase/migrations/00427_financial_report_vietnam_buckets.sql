-- Only this read-only report uses Vietnam calendar buckets. No business rows,
-- permissions, function body, or database-wide timezone are changed.
begin;
alter function public.get_financial_analysis_details_report_v2(
  timestamptz, timestamptz, uuid, boolean, integer
) set timezone to 'Asia/Ho_Chi_Minh';
commit;
