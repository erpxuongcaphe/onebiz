import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

const documents = [
  [
    "00315_disposal_export_list_workspace.sql",
    "disposal_export",
    "disposal_exports",
    "disposal_export_items",
    "disposal_id",
  ],
  ["00313_input_invoice_list_workspace.sql", "input_invoice", "input_invoices"],
  [
    "00316_warehouse_list_workspaces_batch.sql",
    "internal_export",
    "internal_exports",
    "internal_export_items",
    "export_id",
  ],
  [
    "00513_inventory_operational_read_projections.sql",
    "inventory_check",
    "inventory_checks",
  ],
  [
    "00312_purchase_order_list_workspace.sql",
    "purchase_order",
    "purchase_orders",
    "purchase_order_items",
    "purchase_order_id",
  ],
  [
    "00314_supplier_return_list_workspace.sql",
    "supplier_return",
    "supplier_returns",
    "supplier_return_items",
    "return_id",
  ],
];

export async function verifyInventoryDocumentReads(db, id) {
  await db.exec(`
    reset role;
    insert into role_permissions values ('${id(20)}','inventory.view');
    update user_branch_permission_overrides set override_type='revoke' where permission_code='inventory.view';
    alter table products add column cost_price numeric, add column unit text;
    create view products_scoped as select * from products;
    grant select on products_scoped to authenticated;
    create table inventory_check_items(
      id uuid, check_id uuid, product_id uuid, product_name text, system_stock numeric,
      actual_stock numeric, difference numeric, unit_cost numeric
    );
  `);
  for (const [file, name, header, child, key] of documents) {
    await db.exec(
      await functionFromMigration(file, `get_${name}_list_workspace`),
    );
    await db.exec(`
      create table ${header}(
        id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,
        note text,created_at timestamptz default now(),created_by uuid
      );
      insert into ${header}(id,tenant_id,branch_id,code,status,created_by) values
        ('${id(710)}','${id(1)}','${id(10)}','A','balanced','${id(101)}'),
        ('${id(711)}','${id(1)}','${id(11)}','B','balanced','${id(101)}');
      alter table ${header} enable row level security;
      create policy legacy_read on ${header} for select to authenticated using (true);
      grant select on ${header} to authenticated;
    `);
    if (child)
      await db.exec(`
      create table ${child}(id uuid,${key} uuid);
      insert into ${child} values ('${id(720)}','${id(710)}'), ('${id(721)}','${id(711)}');
      alter table ${child} enable row level security;
      create policy legacy_read on ${child} for select to authenticated using (true);
      grant select on ${child} to authenticated;
    `);
  }
  await db.exec(`
    create view inventory_check_items_scoped as select t.* from inventory_check_items t
      where exists(select 1 from inventory_checks o where o.id=t.check_id
        and _can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id));
    grant select on inventory_check_items_scoped to authenticated;
    insert into inventory_check_items values
      ('${id(720)}','${id(710)}','${id(600)}','Coffee',0,10,10,10),
      ('${id(721)}','${id(711)}','${id(600)}','Coffee',0,90,90,10);
    insert into role_permissions values ('${id(20)}','inventory.edit_check');
  `);
  const sourceName = "get_inventory_check_change_source";
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  if (process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE) {
    const definitions = JSON.parse(
      await readFile(process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE, "utf8"),
    );
    for (const name of [
      ...documents.map(([, kind]) => `get_${kind}_list_workspace`),
      sourceName,
    ]) {
      const match = definitions.find((entry) => entry.proname === name);
      assert.ok(match, name);
      await db.exec(match.definition);
    }
  } else {
    await db.exec(
      await functionFromMigration(
        "20261026115757_inventory_check_amendment.sql",
        sourceName,
      ),
    );
  }
  // Match the earlier deployed-in-chain mutation migration for the two
  // action checks in the real change-source function.
  await db.exec(`do $test$ declare source text; code text; begin
    source:=pg_get_functiondef('public.get_inventory_check_change_source(uuid)'::regprocedure);
    foreach code in array array['inventory.edit_check','inventory.cancel_check'] loop
      source:=regexp_replace(source,'user_has_permission\\(([^,]+),\\s*'''||replace(code,'.','\\.')||'''\\)',
        'user_has_permission_at_branch(\\1,'''||code||''',(select staff_check_scope.branch_id from public.inventory_checks staff_check_scope where staff_check_scope.id=p_check_id and staff_check_scope.tenant_id=public.get_user_tenant_id()))','g');
    end loop; execute source; end $test$;`);
  await db.exec(
    await readFile(
      new URL("20261112012240_staff_branch_inventory_document_read.sql", dir),
      "utf8",
    ),
  );
  // Match chronological production order: the later global guard replaces the
  // earlier predicate before batched document policies are installed.
  await db.exec(await functionFromMigration('20261112121837_staff_inventory_global_revoke_guard.sql','_staff_inventory_row_visible'));
  await db.exec(await readFile(new URL('20261112122731_staff_inventory_document_read_batch.sql',dir),'utf8'));
  await db.exec(await readFile(new URL('20261112123610_staff_purchase_action_document_reads.sql',dir),'utf8'));
  await db.exec("set role authenticated");
  const ids = async (table) =>
    (await db.query(`select id from ${table} order by id`)).rows.map(
      (row) => row.id,
    );
  for (const [, name, header, child] of documents) {
    assert.deepEqual(await ids(header), [id(710)]);
    if (child) assert.deepEqual(await ids(child), [id(720)]);
    await assert.rejects(
      db.query(`select get_${name}_list_workspace(p_branch_id=>$1)`, [id(11)]),
      /PERMISSION_DENIED/,
    );
  }
  assert.deepEqual(await ids("inventory_check_items_scoped"), [id(720)]);
  const list = async () =>
    (await db.query("select get_inventory_check_list_workspace() result"))
      .rows[0].result;
  assert.equal((await list()).total, 1);
  assert.equal((await list()).summary.netVariance, 100);
  await assert.rejects(
    db.query("select get_inventory_check_change_source($1)", [id(711)]),
    /BRANCH_ACCESS_DENIED/,
  );
  await db.exec(`
    reset role;
    delete from role_permissions where permission_code='inventory.view';
    update user_branch_permission_overrides set override_type='grant' where permission_code='inventory.view';
    set role authenticated;
  `);
  assert.deepEqual(await ids("inventory_check_items_scoped"), [id(721)]);
  assert.equal((await list()).total, 1);
  assert.equal((await list()).summary.netVariance, 900);
  await db.exec(`reset role; delete from user_branch_permission_overrides where permission_code='inventory.view';
    insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
    values('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
  for (const [, , header, child] of documents) {
    assert.deepEqual(await ids(header),[],'global revoke hides document headers');
    if (child) assert.deepEqual(await ids(child),[],'global revoke hides child rows through parent RLS');
  }
  await db.exec(`reset role; delete from user_permission_overrides where user_id='${id(101)}' and permission_code='inventory.view'; set role authenticated;`);
  for (const [, , header, child] of documents) {
    assert.deepEqual(await ids(header),[],'ungranted inventory view hides document headers');
    if (child) assert.deepEqual(await ids(child),[],'ungranted inventory view hides document lines');
  }
  await db.exec(`reset role;
    create table suppliers(id uuid,tenant_id uuid,code text);
    grant select on suppliers to authenticated;
    alter table purchase_orders add column supplier_id uuid,add column supplier_name text,add column total numeric default 0;
    alter table supplier_returns add column supplier_id uuid,add column supplier_name text,add column import_code text,add column total numeric default 0;
    alter table input_invoices add column supplier_id uuid,add column supplier_name text,add column total_amount numeric default 0,add column tax_amount numeric default 0;
    insert into staff_branch_permission_catalog values('inventory.create_po',1);
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values('${id(1)}','${id(101)}','${id(10)}','inventory.create_po','grant','${id(100)}'); set role authenticated;`);
  for (const [name,header,child] of [['purchase_order','purchase_orders','purchase_order_items'],['supplier_return','supplier_returns','supplier_return_items'],['input_invoice','input_invoices',null]]) {
    assert.deepEqual(await ids(header),[id(710)],'purchase action reads only its own branch documents');
    if (child) assert.deepEqual(await ids(child),[id(720)],'purchase action reads lines only through an allowed parent');
    assert.equal((await db.query(`select get_${name}_list_workspace(p_branch_id=>$1) result`,[id(10)])).rows[0].result.total,1);
    await assert.rejects(db.query(`select get_${name}_list_workspace(p_branch_id=>$1)`,[id(11)]),/PERMISSION_DENIED/);
  }
  assert.deepEqual(await ids('inventory_checks'),[],'purchase action does not grant general stocktake access');
  await db.exec(`reset role; insert into role_permissions values('${id(20)}','reports.view_all_branches');
    insert into purchase_orders(id,tenant_id,branch_id,code,status,created_by) values('${id(712)}','${id(1)}','${id(14)}','C','balanced','${id(101)}'); set role authenticated;`);
  assert.equal((await db.query('select get_purchase_order_list_workspace() result')).rows[0].result.total,1,'all branches never expands the purchase action beyond assigned branches');
  assert.deepEqual(await ids('purchase_orders'),[id(710)]);
  await db.exec(`reset role; delete from purchase_orders where id='${id(712)}'; delete from role_permissions where permission_code='reports.view_all_branches'; set role authenticated;`);
  await db.exec(`reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
    values('${id(1)}','${id(101)}','inventory.view','revoke','${id(100)}'); set role authenticated;`);
  assert.deepEqual(await ids('purchase_orders'),[id(710)],'independent purchase work survives a global inventory-view revoke');
  assert.equal((await db.query('select get_purchase_order_list_workspace(p_branch_id=>$1) result',[id(10)])).rows[0].result.total,1);
  await db.exec(`reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
    values('${id(1)}','${id(101)}','inventory.create_po','revoke','${id(100)}'); set role authenticated;`);
  assert.deepEqual(await ids('purchase_orders'),[],'global purchase revoke wins over local action grant');
  await assert.rejects(db.query('select get_purchase_order_list_workspace(p_branch_id=>$1)',[id(10)]),/PERMISSION_DENIED/);
  await db.exec(`reset role; delete from user_permission_overrides where user_id='${id(101)}' and permission_code in ('inventory.view','inventory.create_po');
    delete from user_branch_permission_overrides where permission_code='inventory.create_po'; set role authenticated;`);
  // Install the stocktake action reader only after verifying the legacy document
  // rules above, then test it with no inherited stocktake/view permissions.
  await db.exec(`reset role; delete from role_permissions where permission_code in ('inventory.check','inventory.edit_check','inventory.cancel_check');
    insert into staff_branch_permission_catalog values ('inventory.check',1),('inventory.edit_check',1),('inventory.cancel_check',1) on conflict do nothing;
    create function _change_inventory_check(p_check_id uuid,p_action text,p_items jsonb,p_note text,p_reason text,p_source_version text,p_request_id uuid,p_preview_token text,p_apply boolean)
    returns boolean language plpgsql as $$ declare actor uuid:=auth.uid(); begin
    return public._staff_permission_at_scope(actor,'inventory.view',(select ic.branch_id from public.inventory_checks ic where ic.id=p_check_id and ic.tenant_id=public.get_user_tenant_id())); end $$;`);
  await db.exec(await readFile(new URL('20261112124158_staff_stocktake_action_document_reads.sql',dir),'utf8'));
  for (const code of ['inventory.check','inventory.edit_check','inventory.cancel_check']) {
    await db.exec(`reset role;
      insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
      values('${id(1)}','${id(101)}','${id(10)}','${code}','grant','${id(100)}'); set role authenticated;`);
    assert.deepEqual(await ids('inventory_checks'),[id(710)],`${code} reads only its assigned branch's stocktake`);
    assert.deepEqual(await ids('inventory_check_items_scoped'),[id(720)],`${code} reads only its allowed stocktake lines`);
    assert.equal((await db.query('select get_inventory_check_list_workspace(p_branch_id=>$1) result',[id(10)])).rows[0].result.total,1);
    if (code !== 'inventory.check') {
      assert.equal((await db.query('select get_inventory_check_change_source($1) result',[id(710)])).rows[0].result.id,id(710),`${code} opens the real change-source document without inventory.view`);
      await assert.rejects(db.query('select get_inventory_check_change_source($1)',[id(711)]),/INSUFFICIENT_PERMISSION|BRANCH_ACCESS_DENIED/);
    }
    await assert.rejects(db.query('select get_inventory_check_list_workspace(p_branch_id=>$1)',[id(11)]),/PERMISSION_DENIED/);
    assert.deepEqual(await ids('purchase_orders'),[],`${code} does not grant purchasing documents`);
    await db.exec(`reset role; insert into user_permission_overrides(tenant_id,user_id,permission_code,override_type,created_by)
      values('${id(1)}','${id(101)}','${code}','revoke','${id(100)}'); set role authenticated;`);
    assert.deepEqual(await ids('inventory_checks'),[],`global revoke wins over local ${code} grant`);
    await db.exec(`reset role; delete from user_permission_overrides where user_id='${id(101)}' and permission_code='${code}';
      delete from user_branch_permission_overrides where user_id='${id(101)}' and permission_code='${code}'; set role authenticated;`);
  }
  await db.exec(`reset role;
    insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values('${id(1)}','${id(101)}','${id(11)}','inventory.view','grant','${id(100)}'); set role authenticated;`);
  console.log(
    "PASS inventory documents: six workspace entry checks, direct headers and lines, and scoped inventory-check totals and details.",
  );
}
