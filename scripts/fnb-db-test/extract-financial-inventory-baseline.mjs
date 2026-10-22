import { readFileSync, writeFileSync } from "node:fs";

const sources = [
  ["00513_inventory_operational_read_projections.sql", "get_xnt_report"],
  ["00540_fnb_inventory_valuation_source.sql", "get_xnt_report_v2"],
  ["00543_fnb_production_value_restatement.sql", "_inventory_value_timeline_00540"],
];

const sql = sources.map(([file, name]) => {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8");
  const match = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "i").exec(source);
  if (!match) throw new Error(`Missing fixture dependency: ${name}`);
  const tail = source.slice(match.index);
  const delimiter = /\bas\s+(\$[a-z_]*\$)/i.exec(tail);
  const bodyStart = delimiter && delimiter.index + delimiter[0].length;
  const end = delimiter && tail.indexOf(delimiter[1], bodyStart);
  const terminator = end >= 0 && /^\s*;/.exec(tail.slice(end + delimiter[1].length));
  if (!delimiter || end < 0 || !terminator) throw new Error(`Missing function boundary: ${name}`);
  return tail.slice(0, end + delimiter[1].length + terminator[0].length);
}).join("\n\n");

writeFileSync(process.argv[2], sql, "utf8");

