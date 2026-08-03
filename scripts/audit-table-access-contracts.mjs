#!/usr/bin/env node

// Read-only static audit for literal Supabase .from("table") chains.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

const cwd = process.cwd();
const roots = ["src/app", "src/lib"];

function walk(path) {
  const absolute = join(cwd, path);
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute).flatMap((name) => walk(join(path, name)));
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

function literalFromCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const expression = unwrap(node.expression);
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "from") {
    return null;
  }
  const argument = node.arguments[0];
  return argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text.toLowerCase()
    : null;
}

function chainedMethods(node) {
  const methods = new Set();
  let current = node.parent;
  while (current) {
    if (ts.isPropertyAccessExpression(current)) methods.add(current.name.text);
    if (
      ts.isVariableDeclaration(current) ||
      ts.isExpressionStatement(current) ||
      ts.isReturnStatement(current) ||
      ts.isAwaitExpression(current)
    ) {
      if (!ts.isAwaitExpression(current)) break;
    }
    current = current.parent;
  }
  return methods;
}

function operationsFor(methods) {
  const operations = new Set();
  if (methods.has("insert")) operations.add("insert");
  if (methods.has("upsert")) {
    operations.add("insert");
    operations.add("update");
  }
  if (methods.has("update")) operations.add("update");
  if (methods.has("delete")) operations.add("delete");
  if (methods.has("select") || operations.size === 0) operations.add("select");
  return operations;
}

const contracts = new Map();
for (const file of roots.flatMap(walk).filter((path) => [".ts", ".tsx"].includes(extname(path)))) {
  const source = readFileSync(join(cwd, file), "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    const table = literalFromCall(node);
    if (table) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      for (const operation of operationsFor(chainedMethods(node))) {
        const key = `${table}|${operation}`;
        const callers = contracts.get(key) ?? [];
        callers.push(
          `${relative(cwd, join(cwd, file)).replaceAll("\\", "/")}:${position.line + 1}`,
        );
        contracts.set(key, callers);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

const rows = [...contracts.entries()]
  .map(([key, callers]) => {
    const [relation, operation] = key.split("|");
    return { relation, operation, callers: [...new Set(callers)].sort() };
  })
  .sort((a, b) => a.relation.localeCompare(b.relation) || a.operation.localeCompare(b.operation));

function sqlText(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

if (process.argv.includes("--sql")) {
  const values = rows
    .map((row) => `    (${sqlText(row.relation)}, ${sqlText(row.operation)})`)
    .join(",\n");
  console.log(`-- READ-ONLY: table access contracts used directly by the current web.
-- Only failed/missing contracts are returned. No business data is changed.

with required(relation_name, operation) as (
  values
${values}
),
checked as (
  select
    r.relation_name,
    r.operation,
    c.oid,
    c.relkind,
    c.relrowsecurity,
    case r.operation
      when 'select' then 'SELECT'
      when 'insert' then 'INSERT'
      when 'update' then 'UPDATE'
      when 'delete' then 'DELETE'
    end as privilege_name,
    case r.operation
      when 'select' then 'r'
      when 'insert' then 'a'
      when 'update' then 'w'
      when 'delete' then 'd'
    end as policy_command
  from required r
  left join pg_class c
    on c.relnamespace = 'public'::regnamespace
   and c.relname = r.relation_name
)
select
  relation_name,
  operation,
  oid is not null as relation_exists,
  coalesce(has_table_privilege('authenticated', oid, privilege_name), false)
    as authenticated_grant_ok,
  case
    when oid is null then false
    when relkind in ('v', 'm') then true
    when not relrowsecurity then true
    else exists (
      select 1
      from pg_policy p
      where p.polrelid = checked.oid
        and p.polcmd::text in (checked.policy_command, '*')
        and (
          0::oid = any(p.polroles)
          or (select oid from pg_roles where rolname = 'authenticated') = any(p.polroles)
        )
    )
  end as applicable_rls_policy_ok,
  coalesce(relrowsecurity, false) as rls_enabled
from checked
where oid is null
   or not coalesce(has_table_privilege('authenticated', oid, privilege_name), false)
   or (
     relkind not in ('v', 'm')
     and relrowsecurity
     and not exists (
       select 1
       from pg_policy p
       where p.polrelid = checked.oid
         and p.polcmd::text in (checked.policy_command, '*')
         and (
           0::oid = any(p.polroles)
           or (select oid from pg_roles where rolname = 'authenticated') = any(p.polroles)
         )
     )
   )
order by relation_name, operation;
`);
  process.exit(0);
}

console.log(
  JSON.stringify(
    {
      relationCount: new Set(rows.map((row) => row.relation)).size,
      contractCount: rows.length,
      contracts: rows,
    },
    null,
    2,
  ),
);
