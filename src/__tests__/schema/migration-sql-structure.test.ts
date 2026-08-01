import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationRoot = "supabase/migrations";
const migrationFiles = readdirSync(migrationRoot)
  .filter((name) => {
    const number = Number(name.slice(0, 5));
    return number >= 242 && number <= 283 && name.endsWith(".sql");
  })
  .sort();

function stripDollarQuotedBodies(sql: string) {
  let output = "";
  let cursor = 0;

  while (cursor < sql.length) {
    const startMatch = sql
      .slice(cursor)
      .match(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (!startMatch || startMatch.index == null) {
      output += sql.slice(cursor);
      break;
    }

    const start = cursor + startMatch.index;
    const tag = startMatch[0];
    const end = sql.indexOf(tag, start + tag.length);
    output += sql.slice(cursor, start);
    if (end < 0) return output + sql.slice(start);
    output += " ";
    cursor = end + tag.length;
  }

  return output;
}

describe("QC migration SQL structure", () => {
  it("uses complete dollar-quoted bodies for every function", () => {
    const issues: string[] = [];

    for (const file of migrationFiles) {
      const sql = readFileSync(`${migrationRoot}/${file}`, "utf8");
      const createCount =
        sql.match(/create\s+or\s+replace\s+function\s+public\./gi)?.length ?? 0;
      const bodyCount =
        sql.match(/\bas\s+\$([A-Za-z_][A-Za-z0-9_]*)?\$/gi)?.length ?? 0;
      const malformed = sql.match(/^\s*(?:as\s+)?\$\s*;?\s*$/gm) ?? [];

      if (createCount !== bodyCount || malformed.length > 0) {
        issues.push(
          `${file}: functions=${createCount}, bodies=${bodyCount}, malformed=${malformed.length}`,
        );
      }
    }

    expect(issues).toEqual([]);
  });

  it("documents the only top-level business-data insert", () => {
    const topLevelDml: string[] = [];

    for (const file of migrationFiles) {
      const sql = stripDollarQuotedBodies(
        readFileSync(`${migrationRoot}/${file}`, "utf8"),
      ).replace(/--[^\n]*/g, "");
      const matches = [
        ...sql.matchAll(
          /^\s*(insert\s+into|update\s+|delete\s+from|truncate\s+)/gim,
        ),
      ];
      for (const match of matches) {
        topLevelDml.push(`${file}:${match[1].trim().toLowerCase()}`);
      }
    }

    expect(topLevelDml).toEqual([
      "00253_harden_retail_pos_pricing.sql:insert into",
    ]);
  });

  it("keeps the read-only preflight aligned with every function definition", () => {
    const expected: string[] = [];
    for (const file of migrationFiles) {
      const sql = readFileSync(`${migrationRoot}/${file}`, "utf8");
      for (const match of sql.matchAll(
        /create\s+or\s+replace\s+function\s+public\.([A-Za-z0-9_]+)\s*\(/gi,
      )) {
        expected.push(`${file.slice(0, 5)}:${match[1]}`);
      }
    }

    const preflight = readFileSync(
      "docs/qc/sql/QC-MIGRATIONS-00242-00283-PREFLIGHT.sql",
      "utf8",
    ).split("available as")[0];
    const actual = [...preflight.matchAll(/\('(\d{5})',\s*'([A-Za-z0-9_]+)'\)/g)]
      .map((match) => `${match[1]}:${match[2]}`);

    expect(actual).toEqual(expected);
  });
});
