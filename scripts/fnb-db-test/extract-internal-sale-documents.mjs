import { readFileSync, writeFileSync } from "node:fs";

const signature = "uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text";

function extract(file) {
  const source = readFileSync(`supabase/migrations/${file}`, "utf8");
  const marker = "create or replace function public.create_internal_sale_atomic(";
  const start = source.indexOf(marker);
  const end = source.indexOf("\n$$;", start);
  if (start < 0 || end < 0 || source.indexOf(marker, start + 1) >= 0) {
    throw new Error(`Internal-sale RPC boundary changed: ${file}`);
  }
  return source.slice(start, end + 4);
}

if (!process.argv[2]) throw new Error("Temporary SQL output path required");
const sql = [
  extract("00243_harden_internal_sale_atomic.sql"),
  `alter function public.create_internal_sale_atomic(${signature}) rename to _create_internal_sale_auth_impl_00243;`,
  extract("00387_fnb_supply_catalog_opt_in_enforcement.sql"),
  `alter function public.create_internal_sale_atomic(${signature}) rename to _create_internal_sale_catalog_impl_00390;`,
].join("\n\n");
writeFileSync(process.argv[2], sql + "\n", "utf8");
