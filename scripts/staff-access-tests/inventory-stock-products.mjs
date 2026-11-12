import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function verifyInventoryStockProducts(db, id) {
  await db.exec(`reset role;
    alter table products add column if not exists product_type text,
      add column if not exists stock_unit text, add column if not exists unit text,
      add column if not exists category_id uuid, add column if not exists supplier_id uuid,
      add column if not exists is_active boolean default true;
    create table categories(id uuid, name text);
    create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,quantity numeric);
    insert into branch_stock values
      ('${id(1)}','${id(10)}','${id(600)}',90),
      ('${id(1)}','${id(11)}','${id(600)}',10);
    delete from user_branch_permission_overrides where permission_code='inventory.view';
    delete from role_permissions where permission_code='inventory.view';
    insert into role_permissions values ('${id(20)}','inventory.view');
    select set_config('request.jwt.claim.sub','${id(101)}',false);
  `);
  if (process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE) {
    const definitions = JSON.parse(await readFile(process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE, "utf8"));
    const current = definitions.find((entry) => entry.proname === "get_products_with_branch_stock");
    assert.ok(current);
    await db.exec(current.definition);
  } else {
    // Public test contract: the captured body is used in the separate audit run.
    await db.exec(`create function public.get_products_with_branch_stock(p_branch_id uuid,p_category_id uuid default null,p_supplier_id uuid default null,p_only_without_lots boolean default false)
      returns table(product_id uuid) language plpgsql security definer set search_path='' as $$
      declare v_tenant_id uuid; begin
        select p.tenant_id into v_tenant_id from public.profiles p where p.id=auth.uid() and p.is_active;
        if v_tenant_id is null or not public.user_has_permission(auth.uid(),'inventory.view') then raise exception 'STOCK_READ_PERMISSION_DENIED'; end if;
        if p_branch_id is null or not public.can_read_branch_document_00567(v_tenant_id,p_branch_id) then raise exception 'STOCK_READ_BRANCH_DENIED'; end if;
        return query select bs.product_id from public.branch_stock bs where bs.tenant_id=v_tenant_id and bs.branch_id=p_branch_id;
      end $$;`);
  }
  await db.exec(await readFile(new URL("../../supabase/migrations/20261112033141_staff_branch_inventory_stock_products.sql", import.meta.url), "utf8"));
  const read = (branch) => db.query("select * from get_products_with_branch_stock($1)", [id(branch)]);
  assert.equal((await read(10)).rows.length, 1);
  assert.equal((await read(11)).rows.length, 1);
  await db.exec(`insert into user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by)
    values ('${id(1)}','${id(101)}','${id(10)}','inventory.view','revoke','${id(100)}');`);
  await assert.rejects(read(10), /STOCK_READ_PERMISSION_DENIED/);
  assert.equal((await read(11)).rows.length, 1);
  await db.exec(`delete from role_permissions where permission_code='inventory.view';
    update user_branch_permission_overrides set branch_id='${id(11)}',override_type='grant' where permission_code='inventory.view';`);
  assert.equal((await read(11)).rows.length, 1);
  await assert.rejects(read(10), /STOCK_READ_PERMISSION_DENIED/);
  await assert.rejects(read(12), /STOCK_READ_PERMISSION_DENIED|STOCK_READ_BRANCH_DENIED/);
  console.log("PASS stock product picker: branch grant/denial and tenant boundary.");
}
