import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync("supabase/migrations/00390_fnb_branch_cost_ledger.sql", "utf8");
const startMarker = "create function public._capture_fnb_branch_cost_stock_movement_00390()";
const endMarker = "drop trigger if exists capture_fnb_branch_cost_stock_movement_00390";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0 || source.indexOf(startMarker, start + 1) >= 0) {
  throw new Error("Original cost trigger boundary changed");
}
if (!process.argv[2]) throw new Error("Temporary SQL output path required");
writeFileSync(process.argv[2], source.slice(start, end), "utf8");
