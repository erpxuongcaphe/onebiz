import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { initializeStaffAccessFixture } from "./staff-access-tests/fixture.mjs";
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const migration = file => readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8");
try {
  await initializeStaffAccessFixture(db,id);
  await db.exec(await migration("20261111052704_staff_branch_access.sql"));
  await db.exec(`create table public.ops_members(tenant_id uuid,branch_id uuid,user_id uuid,member_role text,capabilities text[],active boolean);
    create table public.ops_q_grants(tenant_id uuid,branch_id uuid,user_id uuid,can_audit boolean,can_correct boolean,can_accounting boolean,active boolean);
    insert into public.ops_members values('${id(1)}','${id(10)}','${id(101)}','manager',array['verify'],true),
      ('${id(1)}','${id(11)}','${id(101)}','reviewer',array[]::text[],false);
    insert into public.ops_q_grants values('${id(1)}','${id(11)}','${id(101)}',true,false,false,true);
    select set_config('request.jwt.claim.sub','${id(100)}',false);`);
  await db.exec(await migration("20261114040000_staff_operations_snapshot.sql"));
  const snapshot = async user => (await db.query("select public.get_staff_operations_access($1) value",[user])).rows[0].value;
  const first = await snapshot(id(101));
  assert.equal(first.memberships.length,2);
  assert.equal(first.memberships[1].active,false);
  assert.equal(first.qualityGrants[0].canAudit,true);
  assert.equal((await db.query("select has_function_privilege('anon','public.get_staff_operations_access(uuid)','execute') allowed")).rows[0].allowed,false);
  await assert.rejects(() => snapshot(id(102)),/STAFF_TARGET_INVALID/);
  await db.exec(`update public.ops_members set active=true where user_id='${id(101)}' and branch_id='${id(11)}'`);
  assert.notEqual((await snapshot(id(101))).fingerprint,first.fingerprint);
  await db.exec(`select set_config('request.jwt.claim.sub','${id(101)}',false)`);
  await assert.rejects(() => snapshot(id(101)),/STAFF_OWNER_REQUIRED/);
  console.log("PASS: owner-only Hub snapshot preserves separate memberships, QC and concurrency fingerprint.");
} finally { await db.close(); }
