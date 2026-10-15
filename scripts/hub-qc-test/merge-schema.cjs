const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const input = process.argv[2];
assert.ok(input, 'Pass the reviewed production catalog JSON, never inferred schema');
const patch = JSON.parse(fs.readFileSync(input, 'utf8'));
assert.equal(patch.security.all_rls, true);
assert.equal(patch.security.any_anon_access, false);
assert.equal(patch.security.any_authenticated_write, false);
assert.equal(Object.keys(patch.bang).length, patch.security.tables);
const target = path.resolve(__dirname, '../../src/__tests__/schema/db-schema.json');
const schema = JSON.parse(fs.readFileSync(target, 'utf8'));
for (const table of Object.keys(patch.bang).sort()) {
  assert.match(table, /^ops_q_/);
  if (schema.bang[table]) assert.deepEqual(schema.bang[table], patch.bang[table]);
  else schema.bang[table] = patch.bang[table];
}
for (const rpc of patch.rpc) assert.match(rpc, /^ops_q(?:_|uality_)/);
schema.rpc = [...new Set([...schema.rpc, ...patch.rpc])].sort();
fs.writeFileSync(target, JSON.stringify(schema, null, 1) + '\n');
console.log(`Merged ${patch.security.tables} observed Hub tables and ${patch.rpc.length} observed functions only`);
