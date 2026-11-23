import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { PGlite } = createRequire(process.argv[2] || import.meta.url)("@electric-sql/pglite");
const db = new PGlite();

try {
  // Exercise the migration against both entry-point implementations without live billing data.
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select current_setting('test.actor')::uuid $$;
    create table public.profiles(id uuid, tenant_id uuid, is_active boolean, role text);
    create table actions(reason text);
    insert into public.profiles values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002', true, 'staff'
    );
    create function public.verify_otp_authorization(uuid,text,uuid,uuid) returns uuid
    language plpgsql as $verify$
    begin
      if $1 = '00000000-0000-0000-0000-000000000004' then
        raise exception 'TEST_OTP_EXPIRED_OR_WRONG_BILL';
      end if;
      return $1;
    end;
    $verify$;
    create function public._fnb_void_invoice_impl_00165(
      p_invoice_id uuid,p_kitchen_order_id uuid,p_void_reason text,p_voided_by uuid,
      p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_otp_id uuid
    ) returns text language plpgsql as $pos$
    declare
      v_approver uuid;
    begin
      if p_otp_id is not null then
        v_approver := public.verify_otp_authorization(
          p_otp_id, 'fnb.void_paid_bill', auth.uid(), p_invoice_id
        );
      end if;
      insert into actions values (p_void_reason);
      return p_void_reason;
    end;
    $pos$;
    create function public._void_completed_invoice_atomic_v2_impl_00250(
      p_invoice_id uuid,p_reason text,p_refund_method text,p_shift_id uuid
    ) returns text language plpgsql as $backoffice$
    declare
      v_actor uuid := auth.uid();
      v_tenant_id uuid := '00000000-0000-0000-0000-000000000002';
      v_invoice record;
    begin
      select current_setting('test.source') as source into v_invoice;
      if coalesce(v_invoice.source, '') = 'fnb' then
        perform 1;
      end if;
      insert into actions values (p_reason);
      return p_reason;
    end;
    $backoffice$;
    set test.actor = '00000000-0000-0000-0000-000000000001';
    set test.source = 'fnb';
  `.replace(/^ {4}/gm, ""));
  await db.exec(readFileSync(new URL(
    "../supabase/migrations/20261123042554_fnb_paid_void_reason_and_approval.sql",
    import.meta.url,
  ), "utf8"));
  const actor = "00000000-0000-0000-0000-000000000001";
  const manager = "00000000-0000-0000-0000-000000000003";
  const wrongOtp = "00000000-0000-0000-0000-000000000004";
  const pos = (reason, otp = null) => db.query(`
    select public._fnb_void_invoice_impl_00165(
      null,null,$1,auth.uid(),'00000000-0000-0000-0000-000000000002',null,null,$2
    ) as reason`, [reason, otp]);
  const backoffice = (reason) => db.query(`
    select public._void_completed_invoice_atomic_v2_impl_00250(null,$1,null,null) as reason
  `, [reason]);

  for (const role of ["staff", "cashier"]) {
    await db.query("update public.profiles set role = $1", [role]);
    await assert.rejects(pos("Sai món"), /FNB_VOID_APPROVAL_REQUIRED/);
    await assert.rejects(backoffice("Sai món"), /FNB_VOID_APPROVAL_REQUIRED/);
    await assert.rejects(pos("Sai món", actor), /FNB_VOID_SELF_APPROVAL_DENIED/);
    await assert.rejects(pos("Sai món", wrongOtp), /TEST_OTP_EXPIRED_OR_WRONG_BILL/);
    await assert.rejects(pos(" \t\n ", manager), /FNB_VOID_REASON_REQUIRED/);
  }
  assert.equal((await db.query("select count(*)::int as total from actions")).rows[0].total, 0);
  assert.equal((await pos("  Sai món\n", manager)).rows[0].reason, "Sai món");

  for (const role of ["manager", "admin", "owner"]) {
    await db.query("update public.profiles set role = $1", [role]);
    await assert.rejects(pos(null), /FNB_VOID_REASON_REQUIRED/);
    await assert.rejects(backoffice(" \t\n "), /FNB_VOID_REASON_REQUIRED/);
    assert.equal((await pos("Sai món")).rows[0].reason, "Sai món");
    assert.equal((await backoffice(" Sai món ")).rows[0].reason, "Sai món");
  }
  await db.exec("update public.profiles set role = 'staff'; set test.source = 'pos';");
  assert.equal((await backoffice("Retail")).rows[0].reason, "Retail");
  console.log("F&B paid void policy passed on PostgreSQL.");
} finally {
  await db.close();
}
