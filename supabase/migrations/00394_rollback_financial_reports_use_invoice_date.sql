-- Exact rollback for 00394. Restore only when both functions still carry this
-- migration's marker; refuse to overwrite any later report-function changes.
begin;

do $rollback$
declare
  v_count integer;
  r record;
  v_current text;
begin
  if to_regclass('public.rpc_backup_ngay_hoa_don') is null then
    raise exception '00394 rollback: missing report-function backup table';
  end if;

  select count(*) into v_count
  from public.rpc_backup_ngay_hoa_don
  where migration = '00394'
    and ham_oid in (
      to_regprocedure(
        'public.get_financial_analysis_details_report(timestamptz,timestamptz,uuid,boolean,integer)'
      ),
      to_regprocedure(
        'public.get_consolidated_profit_and_loss_report(timestamptz,timestamptz,timestamptz,timestamptz)'
      )
    );
  if v_count <> 2 then
    raise exception '00394 rollback: expected 2 exact snapshots, found %', v_count;
  end if;

  for r in
    select ham_oid, chu_ky, def_truoc
    from public.rpc_backup_ngay_hoa_don
    where migration = '00394'
  loop
    select pg_get_functiondef(r.ham_oid) into v_current;
    if v_current is null or v_current not like '%ISSUED_AT_REPORT_00394%' then
      raise exception '00394 rollback: % changed after migration; refusing overwrite', r.chu_ky;
    end if;
    execute r.def_truoc;
  end loop;

  for r in
    select ham_oid, chu_ky, def_truoc
    from public.rpc_backup_ngay_hoa_don
    where migration = '00394'
  loop
    if pg_get_functiondef(r.ham_oid) is distinct from r.def_truoc then
      raise exception '00394 rollback: exact restoration failed for %', r.chu_ky;
    end if;
  end loop;
end;
$rollback$;

commit;
