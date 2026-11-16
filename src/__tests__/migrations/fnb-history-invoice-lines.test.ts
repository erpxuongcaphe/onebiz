import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("returns only the selected F&B invoice lines and denies out-of-scope reads", async () => {
  const db = new PGlite();
  const tenant = "10000000-0000-4000-8000-000000000001";
  const branch = "10000000-0000-4000-8000-000000000002";
  const other = "10000000-0000-4000-8000-000000000003";
  const invoice = "10000000-0000-4000-8000-000000000004";
  const draft = "10000000-0000-4000-8000-000000000005";
  const line = "10000000-0000-4000-8000-000000000006";
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''test.actor'',true),'''')::uuid';
      create function public.get_user_tenant_id() returns uuid language sql stable as
        'select nullif(current_setting(''test.tenant'',true),'''')::uuid';
      create function public._can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean
        language sql as 'select current_setting(''test.branch_allowed'',true) = ''yes''';
      create function public._staff_invoice_item_read(uuid,uuid,text) returns boolean
        language sql as 'select current_setting(''test.lines_allowed'',true) = ''yes''';
      create table public.invoices(id uuid,tenant_id uuid,branch_id uuid,source text,deleted_at timestamptz,status text);
      create table public.invoice_items(id uuid,invoice_id uuid,product_name text,quantity numeric,unit_price numeric,total numeric,note text);
      insert into public.invoices values
        ('${invoice}','${tenant}','${branch}','fnb',null,'completed'),
        ('${draft}','${tenant}','${branch}','fnb',null,'draft');
      insert into public.invoice_items values ('${line}','${invoice}','Trà',2,25000,50000,'Ít đá');
    `);
    await db.exec(readFileSync("supabase/migrations/20261116162258_fnb_history_invoice_lines.sql", "utf8"));
    await db.exec(`set role authenticated; set test.actor='${other}'; set test.tenant='${tenant}'; set test.branch_allowed='yes'; set test.lines_allowed='yes';`);
    const read = (id = invoice, branchId = branch) =>
      db.query("select * from public.read_fnb_history_invoice_lines($1,$2)", [id, branchId]);
    expect((await read()).rows).toEqual([{ id: line, product_name: "Trà", quantity: "2", unit_price: "25000", total: "50000", note: "Ít đá" }]);
    await expect(read(invoice, other)).rejects.toMatchObject({ code: "42501" });
    await expect(read(draft)).rejects.toMatchObject({ code: "42501" });
    await db.exec("set test.lines_allowed='no'");
    await expect(read()).rejects.toMatchObject({ code: "42501" });
    await db.exec(`set test.lines_allowed='yes'; set test.tenant='${other}'`);
    await expect(read()).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role; set role anon");
    await expect(read()).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.close();
  }
});
