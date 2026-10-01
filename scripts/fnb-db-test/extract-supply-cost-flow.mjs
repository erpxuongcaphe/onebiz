import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const migration = "00390_fnb_branch_cost_ledger.sql";
const directory = new URL("../../supabase/migrations/", import.meta.url);
const source = readFileSync(new URL(migration, directory), "utf8");
const names = [
  "_fnb_branch_cost_tracking_enabled_00390",
  "_post_fnb_branch_cost_in_00390",
  "_post_fnb_branch_cost_out_00390",
  "create_internal_sale_atomic",
];

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
  if (overrides.length) throw new Error(`Update test source for ${name}: ${overrides.join(", ")}`);

  const matches = [...source.matchAll(new RegExp(definition.source, "gi"))];
  if (matches.length !== 1) throw new Error(`Expected one definition for ${name}`);
  const start = matches[0].index;
  const bodyStart = source.indexOf("as $$", start);
  const end = source.indexOf("\n$$;", bodyStart);
  if (bodyStart < 0 || end < 0) throw new Error(`Function body boundary changed for ${name}`);
  const statement = source.slice(start, end + "\n$$;".length);
  return process.argv.includes("--replace")
    ? statement.replace(/^create function/i, "create or replace function")
    : statement;
});

writeFileSync(process.argv[2], statements.join("\n\n"), "utf8");
