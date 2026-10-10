import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const migration = "00390_fnb_branch_cost_ledger.sql";
const directory = new URL("../../supabase/migrations/", import.meta.url);
const source = readFileSync(new URL(migration, directory), "utf8");
const names = [
  "_fnb_branch_cost_tracking_enabled_00390",
  "_post_fnb_branch_cost_in_00390",
  "_post_fnb_branch_cost_out_00390",
  "create_internal_sale_atomic",
].filter((name) => !process.argv.includes("--ledger-only") || name !== "create_internal_sale_atomic");

if (!process.argv[2]) throw new Error("Temporary SQL output path required");

const laterMigrations = readdirSync(directory).filter(
  (file) => file.endsWith(".sql") && file > migration && !file.includes("rollback"),
);
const statements = names.map((name) => {
  const definition = new RegExp(
    `create (?:or replace )?function public\\.${name}\\s*\\(`,
    "i",
  );
  const overrides = laterMigrations.filter((file) =>
    definition.test(readFileSync(new URL(file, directory), "utf8")),
  );
  const upgraded = ["_post_fnb_branch_cost_in_00390", "_post_fnb_branch_cost_out_00390"].includes(name);
  const expectedOverrides = upgraded ? ["00473_branch_negative_sale_policy.sql"] : [];
  if (JSON.stringify(overrides) !== JSON.stringify(expectedOverrides)) throw new Error(`Update test source for ${name}: ${overrides.join(", ")}`);

  const selectedSource = upgraded ? readFileSync(new URL("00473_branch_negative_sale_policy.sql", directory), "utf8") : source;
  const matches = [...selectedSource.matchAll(new RegExp(definition.source, "gi"))];
  if (matches.length !== 1) throw new Error(`Expected one definition for ${name}`);
  const start = matches[0].index;
  const bodyStart = selectedSource.indexOf("as $$", start);
  const end = selectedSource.indexOf("$$;", bodyStart+5);
  if (bodyStart < 0 || end < 0) throw new Error(`Function body boundary changed for ${name}`);
  const statement = selectedSource.slice(start, end + "$$;".length);
  return process.argv.includes("--replace")
    ? statement.replace(/^create function/i, "create or replace function")
    : statement;
});

// Bounded schema/policy fixtures for the existing positive-stock suites.
// The new policy and RLS are tested by run-negative-stock.cjs using migration 00473.
const fixture = `
alter table public.fnb_branch_product_cost_balances add column if not exists deficit_quantity numeric(18,4) not null default 0;
alter table public.fnb_branch_product_cost_balances add column if not exists opening_cost_confirmed boolean not null default false;
create table if not exists public.fnb_sale_cost_shortfalls_00473(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,cost_event_id uuid,invoice_id uuid,quantity numeric,pending_quantity numeric,estimated_unit_cost numeric,cost_known boolean,settled_actual_cost numeric default 0,created_at timestamptz default now(),updated_at timestamptz default now());
create or replace function public._allow_negative_sale_00473(uuid,uuid) returns boolean language sql as $$select false$$;
`;
writeFileSync(process.argv[2], fixture + statements.join("\n\n"), "utf8");
