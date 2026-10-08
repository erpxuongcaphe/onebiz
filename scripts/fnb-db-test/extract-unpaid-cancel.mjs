import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'supabase/migrations/00066_otp_target_binding.sql'), 'utf8');
function definition(name) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  const end = source.indexOf('$$;', start);
  if (start < 0 || end < start) throw new Error(`Missing function ${name}`);
  return source.slice(start, end + 3);
}
export const cancelFunctions = definition('verify_otp_authorization') + '\n' +
  definition('fnb_cancel_unpaid_order_atomic').replace('public.fnb_cancel_unpaid_order_atomic(', 'public._fnb_cancel_unpaid_order_impl_00066(');
if (process.argv[2]) fs.writeFileSync(process.argv[2], cancelFunctions);
