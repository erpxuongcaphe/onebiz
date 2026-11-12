import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function verifyCashDocumentReads(db, id) {
  await db.exec(`
    alter table shipping_settlements add column created_at timestamptz default now();
    alter table invoices add column source text, add column shift_id uuid;
    alter table cash_transactions add column if not exists occurred_at timestamptz,
      add column if not exists time_source text, add column if not exists time_reason text;
    create function _cod_settlement_rows_v1(uuid,uuid,timestamptz,timestamptz,uuid)
      returns setof jsonb language sql set search_path=public as $$
      select jsonb_build_object('id',id,'code',code,'branchId',branch_id,'createdAt',created_at,
        'partnerName','Test','expectedReceipts',total_cod,'postedReceipts',total_cod,
        'postedFees',0,'postedNet',total_cod,'status','matched')
      from shipping_settlements where tenant_id=$1 and ($2 is null or branch_id=$2)
        and created_at >= $3 and created_at < $4 and ($5 is null or id=$5)
    $$;
    create function _cod_settlement_shipments_v1(uuid,uuid) returns jsonb
      language sql as $$select '[]'::jsonb$$;
    insert into shipping_settlements(id,tenant_id,branch_id,code,total_cod)
      values ('${id(780)}','${id(2)}','${id(3)}','A',100),
        ('${id(781)}','${id(2)}','${id(4)}','B',20);
    insert into test_staff_permissions values('reports.view_all_branches') on conflict do nothing;
    insert into shipping_orders(id,tenant_id,status,code,invoice_id,settlement_id)
      values ('${id(782)}','${id(2)}','delivered','AB','${id(700)}','${id(781)}');
  `);
  const actualPath = process.env.ONEBIZ_CASH_AUDIT_FILE;
  const actual = actualPath
    ? JSON.parse(await readFile(actualPath, "utf8"))
    : [];
  const names = [
    "get_document_payment_history_scoped",
    "get_cod_settlement_trace_v1",
    "get_cod_settlement_workspace_v1",
  ];
  if (actualPath) {
    for (const name of names) {
      const match = actual.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  } else {
    await db.exec(`
      create function get_document_payment_history_scoped(p_reference_type text,p_reference_id uuid,p_offset integer default 0,p_limit integer default 500)
      returns jsonb language plpgsql security definer set search_path=public as $$
      declare v_actor uuid:=auth.uid();v_branch uuid;v_allowed boolean;
      begin
        select branch_id into v_branch from invoices where id=p_reference_id;
        v_allowed:=public.user_has_permission(v_actor,'finance.view_cash_book') or public.user_has_permission(v_actor,'invoices.view');
        if not coalesce(v_allowed,false) then raise exception 'PAYMENT_HISTORY_DENIED';end if;
        return '{}';
      end$$;
      create function get_cod_settlement_trace_v1(p_settlement_id uuid)
      returns jsonb language plpgsql security definer set search_path=public as $$
      declare actor uuid:=auth.uid();t uuid:=get_user_tenant_id();branch uuid;
      begin
        if t is null or not coalesce(public.user_has_permission(actor,'finance.view_cash_book'),false) then raise exception 'COD_TRACE_DENIED';end if;
        select h.branch_id into branch from public.shipping_settlements h where h.id=p_settlement_id and h.tenant_id=t;
        if not found or branch is null or not coalesce(public.user_has_branch_access(actor,branch),false)
          or exists(select 1 from shipping_orders s join invoices i on i.id=s.invoice_id
            where s.settlement_id=p_settlement_id and not coalesce(public.user_has_branch_access(actor,i.branch_id),false)) then raise exception 'COD_TRACE_BRANCH_DENIED';end if;
        return '{}';
      end$$;
      create function get_cod_settlement_workspace_v1(p_branch_id uuid,p_from date,p_to date,p_page integer default 0,
        p_size integer default 50,p_search text default null,p_sort_by text default 'createdAt',p_sort_desc boolean default true,p_with_shipments boolean default false)
      returns jsonb language plpgsql security definer set search_path=public as $$
      declare actor uuid:=auth.uid();t uuid:=get_user_tenant_id();rows jsonb;start_at timestamptz:=p_from;end_at timestamptz:=p_to+1;
      begin
        if t is null or not coalesce(public.user_has_permission(actor,'finance.view_cash_book'),false) then raise exception 'COD_TRACE_DENIED';end if;
        if exists(select 1 from public.shipping_settlements h join shipping_orders s on s.settlement_id=h.id
          left join invoices i on i.id=s.invoice_id
          where h.tenant_id=t and (p_branch_id is null or h.branch_id=p_branch_id) and h.created_at>=start_at and h.created_at<end_at
          and (i.id is null or not coalesce(public.user_has_branch_access(actor,i.branch_id),false))) then raise exception 'COD_TRACE_UNSCOPED_HISTORY';end if;
        with source as (
          select r from public._cod_settlement_rows_v1(t,p_branch_id,start_at,end_at,null) r
          where p_search is null or btrim(p_search)='' or strpos(lower(coalesce(r->>'code','')||' '||coalesce(r->>'partnerName','')),lower(btrim(p_search)))>0
         ), page as (
          select r from source
         ) select coalesce(jsonb_agg(r),'[]') into rows from page;
        return jsonb_build_object('items',rows);
      end$$;
    `);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112031451_staff_branch_cash_document_reads.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const workspace = async (search = null) =>
    (
      await db.query(
        "select get_cod_settlement_workspace_v1(null,current_date-1,current_date,0,50,$1) result",
        [search],
      )
    ).rows[0].result;
  await assert.rejects(workspace(), /COD_TRACE_UNSCOPED_HISTORY/);
  await assert.rejects(
    db.query("select get_cod_settlement_trace_v1($1)", [id(781)]),
    /COD_TRACE_BRANCH_DENIED/,
  );
  await db.query("update shipping_orders set invoice_id=$1 where id=$2", [
    id(701),
    id(782),
  ]);
  assert.deepEqual(
    (await workspace()).items.map((item) => item.id),
    [id(781)],
  );
  assert.deepEqual(
    (await workspace("B")).items.map((item) => item.id),
    [id(781)],
  );
  assert.deepEqual((await workspace("A")).items, []);
  await assert.rejects(
    db.query("select get_cod_settlement_trace_v1($1)", [id(780)]),
    /COD_TRACE_BRANCH_DENIED/,
  );
  await db.query("select get_cod_settlement_trace_v1($1)", [id(781)]);
  await assert.rejects(
    db.query("select get_document_payment_history_scoped('invoice',$1)", [
      id(700),
    ]),
    /PAYMENT_HISTORY_DENIED/,
  );
  console.log(
    "PASS cash documents: permitted COD rows only, search, cross-branch shipment denial and payment history scope.",
  );
}
