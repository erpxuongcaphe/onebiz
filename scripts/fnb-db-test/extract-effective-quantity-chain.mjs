import fs from 'node:fs';
import { cancelFunctions } from './extract-unpaid-cancel.mjs';

const source = fs.readFileSync('supabase/migrations/00424_fnb_kds_exact_return_quantities.sql', 'utf8');
const start = source.indexOf('create or replace function public._fnb_kitchen_remaining_00424(');
const end = source.indexOf('$$;', start);
if (start < 0 || end < start) throw new Error('KDS quantity function boundary changed');
if (!process.argv[2]) throw new Error('Temporary SQL output path required');
fs.writeFileSync(process.argv[2], cancelFunctions + '\n' + source.slice(start, end + 3));
