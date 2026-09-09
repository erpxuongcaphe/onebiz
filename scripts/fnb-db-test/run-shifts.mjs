import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.env.FNB_EPHEMERAL_DB !== 'onebiz_fnb_test') {
  throw new Error('Run only against the dedicated ephemeral test service.');
}

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const sourceFile = '00298_fix_shift_open_close_reconcile_flow.sql';
const functionNames = [
  '_finalize_shift_atomic_00298',
  'open_shift_atomic',
  'close_shift_atomic',
];

function extractFunction(file, name) {
  const pattern = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  const later = readdirSync(migrations)
    .filter((candidate) => candidate.endsWith('.sql') && candidate > file && !/rollback/i.test(candidate))
    .filter((candidate) => pattern.test(readFileSync(new URL(candidate, migrations), 'utf8')));
  if (later.length) throw new Error(`Update shift test source for ${name}: ${later.join(', ')}`);

  const migration = readFileSync(new URL(file, migrations), 'utf8');
  const start = migration.search(pattern);
  if (start < 0) throw new Error(`Missing ${name}`);
  const tail = migration.slice(start);
  const delimiter = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  if (!delimiter) throw new Error(`Missing function body: ${name}`);
  const end = tail.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length);
  if (end < 0) throw new Error(`Unterminated body: ${name}`);
  console.log(`Testing source: ${file} / ${name}`);
  return tail.slice(0, end + delimiter[1].length + 1);
}

const sql = [
  readFileSync(new URL('./schema-shifts.sql', import.meta.url), 'utf8'),
  ...functionNames.map((name) => extractFunction(sourceFile, name)),
  readFileSync(new URL('./cases-shifts.sql', import.meta.url), 'utf8'),
].join('\n');

const result = spawnSync('psql', [
  '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55432',
  '-U', 'fnb_test', '-d', 'onebiz_fnb_test',
], {
  input: sql,
  encoding: 'utf8',
  env: {
    PATH: process.env.PATH,
    PGPASSWORD: 'ephemeral-test-only',
    PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: '5',
  },
});

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
