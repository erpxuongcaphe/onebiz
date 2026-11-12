import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

const documents = [
  [
    "stock_transfer",
    "stock_transfers",
    "stock_transfer_items",
    "transfer_id",
    "transaction_branch_read_00567",
  ],
  [
    "internal_sale",
    "internal_sales",
    "internal_sale_items",
    "internal_sale_id",
    "internal_sales_scope_00476",
  ],
];

export async function verifyTwoBranchInventoryReads(db, id) {
  await db.exec(`
    reset role;
    alter table branches add column code text;
    insert into branches(id,tenant_id,name,code) values ('${id(13)}','${id(1)}','Unassigned','C');
    create function can_read_branch_document_00567(uuid,uuid) returns boolean
    language sql stable set search_path=public
    as $$ select _can_read_branch_inventory_00476(auth.uid(),$1,$2) $$;
  `);
  const audit = process.env.ONEBIZ_INVENTORY_LOT_AUDIT_FILE;
  const definitions = audit ? JSON.parse(await readFile(audit, "utf8")) : [];
  for (const [kind, header, child, key, policy] of documents) {
    const name = `get_${kind}_list_workspace`;
    const definition = definitions.find(
      (entry) => entry.proname === name,
    )?.definition;
    if (audit) assert.ok(definition, name);
    await db.exec(
      definition ??
        (await functionFromMigration(
          "00316_warehouse_list_workspaces_batch.sql",
          name,
        )),
    );
    await db.exec(`
      create table ${header}(id uuid primary key,tenant_id uuid,from_branch_id uuid,to_branch_id uuid,
        code text,status text,note text,created_at timestamptz default now(),created_by uuid,
        total_items integer,total numeric,tax_amount numeric);
      insert into ${header}(id,tenant_id,from_branch_id,to_branch_id,code,status,created_by,total_items,total,tax_amount) values
        ('${id(910)}','${id(1)}','${id(10)}','${id(11)}','AB','completed','${id(101)}',1,10,1),
        ('${id(911)}','${id(1)}','${id(11)}','${id(13)}','BC','completed','${id(101)}',2,20,2),
        ('${id(912)}','${id(1)}','${id(10)}','${id(13)}','AC','completed','${id(101)}',4,40,4);
      create table ${child}(id uuid,${key} uuid,product_code text,product_name text);
      insert into ${child} select id,id,'C','Coffee' from ${header};
      alter table ${header} enable row level security;
      alter table ${child} enable row level security;
      create policy legacy_read on ${header} for select to authenticated using (tenant_id=get_user_tenant_id());
      create policy ${policy} on ${header} as restrictive for select to authenticated
        using (can_read_branch_document_00567(tenant_id,from_branch_id) or can_read_branch_document_00567(tenant_id,to_branch_id));
      create policy legacy_read on ${child} for select to authenticated
        using (exists(select 1 from ${header} h where h.id=${child}.${key}));
      grant select on ${header},${child} to authenticated;
    `);
  }
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20261112020323_staff_branch_inventory_two_branch_read.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const check = async (expected, quantity, value, deniedBranch) => {
    for (const [kind, header, child] of documents) {
      const result = (
        await db.query(`select get_${kind}_list_workspace() result`)
      ).rows[0].result;
      assert.deepEqual(result.items.map((row) => row.id).sort(), expected);
      assert.equal(
        kind === "stock_transfer"
          ? result.summary.totalItems
          : result.summary.totalValue,
        kind === "stock_transfer" ? quantity : value,
      );
      for (const table of [header, child]) {
        assert.deepEqual(
          (await db.query(`select id from ${table} order by id`)).rows.map(
            (row) => row.id,
          ),
          expected,
        );
      }
      await assert.rejects(
        db.query(`select get_${kind}_list_workspace(p_branch_id=>$1)`, [
          deniedBranch,
        ]),
        /PERMISSION_DENIED/,
      );
    }
  };
  await db.exec("set role authenticated");
  await check([id(910), id(911)], 3, 30, id(10));
  await db.exec(`reset role;
    insert into role_permissions values ('${id(20)}','inventory.view');
    update user_branch_permission_overrides set override_type='revoke' where permission_code='inventory.view';
    set role authenticated;`);
  await check([id(910), id(912)], 5, 50, id(11));
  console.log(
    "PASS two-branch inventory: same-side access, selected branch denial, totals, and direct documents and lines.",
  );
}
