import { readFileSync, writeFileSync } from "node:fs";

const file = "supabase/migrations/00123_branch_cascade_mode.sql";
const source = readFileSync(file, "utf8");
const functions = ["should_cascade_bom_at_branch", "internal_sale_apply_stock_out"];

function extract(name) {
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0 || source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`Internal-sale function boundary changed: ${name}`);
  }
  return source.slice(start, end + 4);
}

if (!process.argv[2]) throw new Error("Temporary SQL output path required");
writeFileSync(process.argv[2], functions.map(extract).join("\n\n") + "\n", "utf8");
