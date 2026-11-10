// Runs after the existing isolated PostgreSQL hierarchy fixture. No network.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function testStaffAccess(db, id) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id(100)}',false);
    alter table roles alter column id set default gen_random_uuid();
    alter table roles add column description text, add column color text, add column is_system boolean default false,
      add column created_at timestamptz default now(), add column updated_at timestamptz default now();
    insert into test_permissions values('${id(100)}','system.manage_roles');`);
  const roleSql = await readFile(new URL('../supabase/migrations/00282_atomic_role_management.sql', import.meta.url), 'utf8');
  await db.exec(roleSql.slice(0, roleSql.indexOf('create or replace function public.delete_role_atomic')));
  const updateSql = await readFile(new URL('../supabase/migrations/00279_atomic_managed_user_update.sql', import.meta.url), 'utf8');
  await db.exec(updateSql.replaceAll('update_managed_user_atomic', 'update_managed_user_before_scope'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261110144448_unified_staff_access.sql', import.meta.url), 'utf8'));
  const snapshot = async () => (await db.query('select get_account_hierarchy() as s')).rows[0].s;
  const save = async (s, roles = [], assignments = []) => {
    const preview = (await db.query('select preview_account_hierarchy($1,$2) as p', [JSON.stringify(s.document), s.version])).rows[0].p;
    return (await db.query('select save_staff_access($1,$2,$3,$4,$5) as s', [JSON.stringify(s.document), s.version, preview.fingerprint, JSON.stringify(roles), JSON.stringify(assignments)])).rows[0].s;
  };
  let s = await snapshot();
  const position = { id: 'test-unified', name: 'Cửa hàng trưởng', parentId: null, scope: 'assigned', depth: 'all', roleId: 'new-role', permissions: { create: true, edit: false, password: false } };
  s.document.positions.push(position);
  s.document.assignments.push({ userId: id(102), positionId: position.id, departmentId: null, managedBranchIds: [id(10)] });
  const draft = { id: 'new-role', name: 'Unified role', isNew: true, permissions: ['inventory.view'], expectedPermissions: [] };
  s = await save(s, [draft], [{ userId: id(102), roleId: 'new-role', expectedRoleId: null }]);
  const linked = s.document.positions.find(p => p.id === position.id).roleId;
  assert.match(linked, /^[0-9a-f-]{36}$/);
  assert.equal((await db.query('select role_id from profiles where id=$1', [id(102)])).rows[0].role_id, linked);
  assert.equal((await db.query('select branch_id from profiles where id=$1', [id(102)])).rows[0].branch_id, id(10));
  const changed = { ...draft, id: linked, isNew: false, permissions: ['inventory.view','products.view'], expectedPermissions: ['inventory.view'] };
  await assert.rejects(save(s, [changed], [{ userId: id(102), roleId: linked, expectedRoleId: null }]), /STAFF_USER_STALE/);
  assert.equal((await snapshot()).version, s.version, 'failed assignment rolls back hierarchy');
  assert.deepEqual((await db.query('select permission_code from role_permissions where role_id=$1', [linked])).rows.map(r => r.permission_code), ['inventory.view'], 'failed assignment rolls back role permissions');
  await assert.rejects(save(s, [{ ...changed, expectedPermissions: [] }]), /STAFF_ROLE_STALE/);
  const crossTenant = structuredClone(s); crossTenant.document.positions.find(p => p.id === position.id).roleId = id(999);
  await assert.rejects(save(crossTenant), /STAFF_ROLE_NOT_FOUND/);
  await assert.rejects(save(s, [], [{ userId: id(105), roleId: linked, expectedRoleId: null }]), /STAFF_TARGET_INVALID/);
  s = await save(s, [changed]);
  assert.equal((await db.query('select count(*)::int as n from role_permissions where role_id=$1', [linked])).rows[0].n, 2);
  await db.exec(`select set_config('request.jwt.claim.sub','${id(102)}',false); set role authenticated;`);
  await assert.rejects(db.query("select save_staff_access('{}',0,'x','[]','[]')"), /OWNER_REQUIRED/);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query("select save_staff_access('{}',0,'x','[]','[]')"), /permission denied/);
  await db.exec('reset role');
  console.log('Unified staff access: create/link, assignment, branch preservation, rollback, stale writes, tenant isolation and owner-only access passed.');
}
