// Run the real migration against a disposable in-memory PostgreSQL instance.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create table tenants(id uuid primary key);
    create table branches(id uuid primary key,tenant_id uuid);
    create table profiles(id uuid primary key,tenant_id uuid,is_active boolean,permissions text[],branch_ids uuid[]);
    create function user_has_permission(uuid,text) returns boolean language sql stable as $$select $2=any(permissions) from profiles where id=$1$$;
    create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $2=any(branch_ids) from profiles where id=$1$$;
    insert into tenants values('${id(1)}'),('${id(2)}');
    insert into branches values('${id(10)}','${id(1)}'),('${id(11)}','${id(1)}'),('${id(20)}','${id(2)}');
    insert into profiles values
      ('${id(3)}','${id(1)}',true,array['system.manage_branches'],array['${id(10)}'::uuid]),
      ('${id(4)}','${id(1)}',true,array['pos_fnb.send_kitchen'],array['${id(10)}'::uuid]),
      ('${id(5)}','${id(2)}',true,array['system.manage_branches'],array['${id(20)}'::uuid]),
      ('${id(6)}','${id(1)}',false,array['system.manage_branches'],array['${id(10)}'::uuid]);`);
  await db.exec(fs.readFileSync("supabase/migrations/202610200001_fnb_delivery_price_policy.sql", "utf8"));
  const actor = async n => { await db.query("select set_config('test.actor',$1,false)", [id(n)]); };
  const read = async (branch = 10) => (await db.query("select get_fnb_delivery_price_policy($1) p", [id(branch)])).rows[0].p;
  const save = async (p, revision = 0, branch = 10) => (await db.query("select save_fnb_delivery_price_policy($1,$2,$3) p", [id(branch), revision, JSON.stringify(p)])).rows[0].p;
  const rule = { id: "r1", name: "500 m–1 km, bill dưới 50k", fromMeters: 500, toMeters: 1000, fromAmount: 0, toAmount: 50000, fee: 5000, enabled: true };
  const policy = { enabled: true, amountBasis: "after_discount", rules: [rule, { ...rule, id: "r2", name: "Từ 50k", fromAmount: 50000, toAmount: null, fee: 0 }] };
  await actor(3);
  assert.equal((await read()).enabled, false);
  assert.equal((await save(policy)).revision, 1);
  await assert.rejects(save(policy, 0), /DELIVERY_POLICY_CONFLICT/);
  await assert.rejects(save({ ...policy, rules: [rule, { ...rule, id: "r3" }] }, 1), /DELIVERY_POLICY_INVALID/);
  await assert.rejects(save({ ...policy, rules: [{ ...rule, fee: -1 }] }, 1), /DELIVERY_POLICY_INVALID/);
  await assert.rejects(save({ ...policy, rules: [{ ...rule, toMeters: 500 }] }, 1), /DELIVERY_POLICY_INVALID/);
  await assert.rejects(save({ ...policy, rules: [{ ...rule, fee: null }] }, 1), /DELIVERY_POLICY_INVALID/);
  await assert.rejects(read(11), /PERMISSION_DENIED/);
  await assert.rejects(read(20), /PERMISSION_DENIED/);
  await actor(4);
  assert.equal((await read()).revision, 1);
  await assert.rejects(save(policy, 1), /PERMISSION_DENIED/);
  await actor(5);
  await assert.rejects(read(), /PERMISSION_DENIED/);
  await actor(6);
  await assert.rejects(read(), /PERMISSION_DENIED/);
  await actor(3);
  assert.equal((await save({ ...policy, enabled: false }, 1)).revision, 2);
  assert.equal((await read()).enabled, false);
  await db.exec("set role authenticated");
  await assert.rejects(db.query("select * from public.fnb_delivery_price_policies"), /permission denied/);
  await db.exec("reset role");
  assert.equal((await db.query("select has_function_privilege('anon','get_fnb_delivery_price_policy(uuid)','EXECUTE') allowed")).rows[0].allowed, false);
  console.log("PASS: delivery policy persistence, boundaries, revision conflict, tenant/branch/role isolation, inactive actor and direct-table denial.");
} finally { await db.close(); }
