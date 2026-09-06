import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// No URLs, env files, production credentials, or arbitrary host arguments accepted.
if (process.env.FNB_EPHEMERAL_DB !== 'onebiz_fnb_test') {
  throw new Error('Run only against the dedicated ephemeral test service.');
}
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const sources = [
  ['00011_atomic_stock_rpcs.sql', 'increment_product_stock'],
  ['00156_branch_stock_null_variant_guard.sql', 'upsert_branch_stock'],
  ['00147_variant_aware_bom_lookup.sql', 'get_active_bom_for_branch'],
  ['00142_block_expired_lots_fifo.sql', 'allocate_lots_fifo'],
  ['00350_fnb_exact_modifier_bom_quantities.sql', 'consume_bom_for_sale'],
];
const definitions = sources.map(([file, name]) => {
  const pattern = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  const later = readdirSync(migrations).filter(f => f.endsWith('.sql') && f > file && !/rollback/i.test(f))
    .filter(f => pattern.test(readFileSync(new URL(f, migrations), 'utf8')));
  if (later.length) throw new Error(`Update test source for ${name}: ${later.join(', ')}`);
  const sql = readFileSync(new URL(file, migrations), 'utf8');
  const start = sql.search(pattern);
  if (start < 0) throw new Error(`Missing ${name}`);
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  if (!delimiter) throw new Error(`Missing function body: ${name}`);
  const end = tail.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length);
  if (end < 0) throw new Error(`Unterminated body: ${name}`);
  console.log(`Testing source: ${file} / ${name}`);
  return tail.slice(0, end + delimiter[1].length + 1);
});
const sql = [readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'), ...definitions,
  readFileSync(new URL('./cases.sql', import.meta.url), 'utf8')].join('\n');
const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55432',
  '-U', 'fnb_test', '-d', 'onebiz_fnb_test'], {
  input: sql, encoding: 'utf8',
  env: { PATH: process.env.PATH, PGPASSWORD: 'ephemeral-test-only', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5' },
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
