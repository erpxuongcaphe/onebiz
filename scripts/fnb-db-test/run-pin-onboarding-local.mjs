import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const library = process.argv[2];
const { PGlite } = await import(library ? pathToFileURL(path.resolve(library)).href : '@electric-sql/pglite');
const { pgcrypto } = await import(library ? pathToFileURL(path.join(path.dirname(path.resolve(library)), 'contrib/pgcrypto.js')).href : '@electric-sql/pglite/contrib/pgcrypto');
function expand(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\\ir\s+(.+)$/gm, (_, target) => expand(path.resolve(path.dirname(file), target.trim()))).replace(/^\\set.*$/gm, '');
}
const db = new PGlite({ extensions: { pgcrypto } });
try { await db.exec(expand(path.resolve('supabase/tests/00459_pos_pin_onboarding.integration.sql'))); console.log('PASS: isolated PostgreSQL PIN lifecycle, bcrypt, scoped manager reset and persistent lockout'); }
catch(e) { console.error(e.message, e.detail ?? '', e.where ?? ''); process.exitCode = 1; }
finally { await db.close(); }
