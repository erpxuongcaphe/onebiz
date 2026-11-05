import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : "@electric-sql/pglite");
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const save = async (order, note, base) => (await rows("select fnb_save_order_note_v1($1,$2,$3) result", [id(order), note, base]))[0].result;
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function user_has_permission(uuid,text) returns boolean language sql stable as $$
      select $1 in ('${id(1)}'::uuid,'${id(3)}'::uuid) and $2='pos_fnb.send_kitchen'
    $$;
    create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $2='${id(10)}'::uuid$$;
    create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
    insert into profiles values ('${id(1)}','${id(5)}',true),('${id(2)}','${id(5)}',true),('${id(3)}','${id(5)}',false);
    create table kitchen_orders(id uuid primary key,tenant_id uuid,branch_id uuid,status text,note text,invoice_id uuid,merged_into_id uuid,
      updated_at timestamptz default now(), customer_name text default 'Khách lẻ', discount_amount numeric default 1250);
    create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
    alter table kitchen_orders enable row level security;
    insert into kitchen_orders(id,tenant_id,branch_id,status,note,invoice_id,merged_into_id) values
      ('${id(20)}','${id(5)}','${id(10)}','served',null,null,null),
      ('${id(21)}','${id(5)}','${id(11)}','ready',null,null,null),
      ('${id(22)}','${id(6)}','${id(10)}','pending',null,null,null),
      ('${id(23)}','${id(5)}','${id(10)}','served',null,'${id(50)}',null),
      ('${id(24)}','${id(5)}','${id(10)}','cancelled',null,null,null),
      ('${id(25)}','${id(5)}','${id(10)}','ready',null,null,'${id(20)}');
    grant usage on schema public, auth to anon, authenticated;
  `);
  const migration = fs.readFileSync("supabase/migrations/20261105055422_fnb_saved_order_note.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`select set_config('test.actor','${id(1)}',false); set role authenticated;`);
  const first = await save(20, "Khách ngồi ngoài\nKhông nhận giấy", "");
  assert.equal(first.note, "Khách ngồi ngoài\nKhông nhận giấy");
  assert.ok(Number.isFinite(Date.parse(first.updated_at)));
  assert.deepEqual(await save(20, first.note, ""), first);
  assert.deepEqual(await save(20, "Sửa từ máy khác", ""), { ...first, conflict: true });
  assert.equal((await save(20, "", first.note)).note, "");
  assert.equal((await save(20, "Ghi chú mới", "")).note, "Ghi chú mới");
  for (const n of [21, 22, 999]) await assert.rejects(() => save(n, "Không được sửa", ""), /ORDER_NOTE_ACCESS_DENIED/);
  for (const n of [23, 24, 25]) await assert.rejects(() => save(n, "Không được sửa", ""), /ORDER_NOTE_NOT_UNPAID/);
  await assert.rejects(() => save(20, "a".repeat(1001), ""), /1.000/);
  for (const actor of [2, 3]) {
    await db.exec(`select set_config('test.actor','${id(actor)}',false)`);
    await assert.rejects(() => save(20, "Không có quyền", ""), /ORDER_NOTE_ACCESS_DENIED/);
  }
  await db.exec("reset role; set role anon");
  await assert.rejects(() => save(20, "Chưa đăng nhập", ""), /permission denied/);
  await db.exec("reset role");
  const [order] = await rows("select note,status,customer_name,discount_amount,invoice_id from kitchen_orders where id=$1",[id(20)]);
  assert.deepEqual(order,{ note: "Ghi chú mới", status: "served", customer_name: "Khách lẻ", discount_amount: "1250", invoice_id: null });
  const audit = await rows("select user_id,entity_id,old_data,new_data from audit_log");
  assert.equal(audit.length, 3, "only actual accepted note changes are audited");
  assert.equal(audit[0].user_id, id(1));
  assert.equal(audit[0].entity_id, id(20));
  assert.equal(audit[1].new_data.note, null);
  console.log("PASS: sent-order notes, clear, retry, conflict, branch/tenant/role boundaries, unpaid guard and audit.");
} finally { await db.close(); }
