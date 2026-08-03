#!/usr/bin/env node

// Read-only audit: compare named arguments sent by web RPC calls with the
// parameter names declared by versioned Supabase functions.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

const cwd = process.cwd();
const sourceRoots = ["src/app", "src/lib"];
const migrationRoot = "supabase/migrations";

function walk(path) {
  const absolute = join(cwd, path);
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute).flatMap((name) => walk(join(path, name)));
}

function splitParameters(signature) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;

  for (const character of signature) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
    } else if (character === "(") {
      depth += 1;
      current += character;
    } else if (character === ")") {
      depth -= 1;
      current += character;
    } else if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function readFunctionDefinitions(file) {
  const sql = readFileSync(join(cwd, file), "utf8");
  const definitions = [];
  const pattern = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi;

  for (const match of sql.matchAll(pattern)) {
    const start = match.index + match[0].length;
    let end = start;
    let depth = 1;
    while (end < sql.length && depth > 0) {
      if (sql[end] === "(") depth += 1;
      if (sql[end] === ")") depth -= 1;
      end += 1;
    }
    if (depth !== 0) continue;

    const signature = sql
      .slice(start, end - 1)
      .replace(/--[^\n\r]*/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    const params = [];
    for (const raw of splitParameters(signature)) {
      const cleaned = raw.trim();
      if (!cleaned) continue;

      const tokens = cleaned.split(/\s+/);
      const mode = tokens[0]?.toLowerCase();
      if (mode === "out") continue;
      const nameIndex = ["in", "inout", "variadic"].includes(mode) ? 1 : 0;
      const name = tokens[nameIndex]?.replaceAll('"', "").toLowerCase();
      if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) continue;
      params.push({
        name,
        optional: /\bdefault\b|:=/i.test(cleaned),
      });
    }

    definitions.push({
      name: match[1].toLowerCase(),
      file: relative(cwd, join(cwd, file)).replaceAll("\\", "/"),
      params,
    });
  }
  return definitions;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function objectKeys(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const keys = [];
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property) || !property.name) return null;
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)
    ) {
      const name = property.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        keys.push(name.text.toLowerCase());
        continue;
      }
    }
    return null;
  }
  return [...new Set(keys)].sort();
}

function callContract(node) {
  if (!ts.isCallExpression(node)) return null;
  const expression = unwrap(node.expression);
  let nameIndex = -1;
  let argsIndex = -1;

  if (ts.isPropertyAccessExpression(expression) && expression.name.text === "rpc") {
    nameIndex = 0;
    argsIndex = 1;
  } else if (ts.isIdentifier(expression) && expression.text === "callReportingRpc") {
    nameIndex = 0;
    argsIndex = 1;
  } else if (ts.isIdentifier(expression) && expression.text === "callMktRpc") {
    nameIndex = 1;
    argsIndex = 2;
  } else {
    return null;
  }

  const name = literalText(node.arguments[nameIndex]);
  if (!name) return { dynamicName: true };
  return {
    name: name.toLowerCase(),
    args: objectKeys(node.arguments[argsIndex]) ?? null,
    line: 0,
  };
}

const migrationFiles = walk(migrationRoot)
  .filter((path) => extname(path) === ".sql")
  .sort();
const definitionsByName = new Map();
for (const file of migrationFiles) {
  for (const definition of readFunctionDefinitions(file)) {
    const entries = definitionsByName.get(definition.name) ?? [];
    entries.push(definition);
    definitionsByName.set(definition.name, entries);
  }
}

const calls = [];
let dynamicNameCount = 0;
for (const file of sourceRoots.flatMap(walk).filter((path) => [".ts", ".tsx"].includes(extname(path)))) {
  const source = readFileSync(join(cwd, file), "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    const contract = callContract(node);
    if (contract?.dynamicName) dynamicNameCount += 1;
    if (contract?.name) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      calls.push({
        ...contract,
        file: relative(cwd, join(cwd, file)).replaceAll("\\", "/"),
        line: position.line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function matches(call, definition) {
  if (!call.args) return false;
  const sent = new Set(call.args);
  const declared = new Set(definition.params.map((param) => param.name));
  const required = definition.params.filter((param) => !param.optional).map((param) => param.name);
  return call.args.every((name) => declared.has(name)) && required.every((name) => sent.has(name));
}

function sqlText(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlTextArray(values) {
  if (values.length === 0) return "array[]::text[]";
  return `array[${values.map(sqlText).join(", ")}]::text[]`;
}

if (process.argv.includes("--sql")) {
  const contracts = new Map();
  for (const call of calls) {
    if (!call.args) continue;
    const key = `${call.name}|${call.args.join(",")}`;
    contracts.set(key, call);
  }
  const rows = [...contracts.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.args.join().localeCompare(b.args.join()))
    .map((call) => `    (${sqlText(call.name)}, ${sqlTextArray(call.args)})`)
    .join(",\n");

  console.log(`-- READ-ONLY: exact named-argument contracts used by the current web.
-- It checks live Supabase metadata only and changes no business data.

with required(function_name, sent_args) as (
  values
${rows}
),
live as (
  select
    p.oid,
    p.proname as function_name,
    coalesce(p.proargnames[1:p.pronargs], array[]::text[]) as input_args,
    coalesce(
      p.proargnames[1:greatest(p.pronargs - p.pronargdefaults, 0)],
      array[]::text[]
    ) as required_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select
  r.function_name,
  r.sent_args,
  exists (
    select 1
    from live l
    where l.function_name = r.function_name
      and r.sent_args <@ l.input_args
      and l.required_args <@ r.sent_args
  ) as exact_named_contract_ok,
  coalesce(
    (
      select array_agg(pg_get_function_identity_arguments(l.oid) order by l.oid)
      from live l
      where l.function_name = r.function_name
    ),
    array[]::text[]
  ) as live_signatures
from required r
where not exists (
  select 1
  from live l
  where l.function_name = r.function_name
    and r.sent_args <@ l.input_args
    and l.required_args <@ r.sent_args
)
order by r.function_name, r.sent_args;
`);
  process.exit(0);
}

const mismatches = [];
let dynamicArgsCount = 0;
for (const call of calls) {
  if (!call.args) {
    dynamicArgsCount += 1;
    continue;
  }
  const definitions = definitionsByName.get(call.name) ?? [];
  if (definitions.some((definition) => matches(call, definition))) continue;
  mismatches.push({
    name: call.name,
    caller: `${call.file}:${call.line}`,
    sent: call.args,
    declared: definitions.map((definition) => ({
      file: definition.file,
      params: definition.params.map((param) => `${param.name}${param.optional ? "?" : ""}`),
    })),
  });
}

const result = {
  literalCallCount: calls.length,
  checkedCallCount: calls.length - dynamicArgsCount,
  dynamicArgsCount,
  dynamicNameCount,
  mismatchCount: mismatches.length,
  mismatches,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = mismatches.length === 0 ? 0 : 1;
