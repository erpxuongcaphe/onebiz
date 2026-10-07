import fs from 'node:fs';
const source=fs.readFileSync('supabase/migrations/00400_fnb_inventory_adjustment_transfer_cost.sql','utf8');
const start=source.indexOf('create function public._capture_fnb_inventory_cost_event_00400()');
const end=source.indexOf('\n$$;',start);
if(start<0||end<0)throw new Error('Inventory cost trigger not found');
fs.writeFileSync(process.argv[2],source.slice(start,end+4));
