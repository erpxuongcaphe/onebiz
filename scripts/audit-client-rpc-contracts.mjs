#!/usr/bin/env node

// Read-only static audit: compare literal RPC calls in the web source with
// function definitions present in versioned Supabase migrations.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const cwd = process.cwd();
const sourceRoots = ["src/app", "src/lib"];
const migrationRoot = "supabase/migrations";

function walk(path) {
  const absolute = join(cwd, path);
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute).flatMap((name) => walk(join(path, name)));
}

const sourceFiles = sourceRoots
  .flatMap(walk)
  .filter((path) => [".ts", ".tsx"].includes(extname(path)));
const migrationFiles = walk(migrationRoot).filter((path) => extname(path) === ".sql");

const calls = new Map();
const callPatterns = [
  /\.rpc(?:\s+as\s+any)?\s*\)?\s*\(\s*["']([a-zA-Z0-9_]+)["']/g,
  /callReportingRpc\s*\(\s*["']([a-zA-Z0-9_]+)["']/g,
  /callMktRpc\s*\(\s*[^,]+,\s*["']([a-zA-Z0-9_]+)["']/g,
];

for (const file of sourceFiles) {
  const source = readFileSync(join(cwd, file), "utf8");
  for (const pattern of callPatterns) {
    for (const match of source.matchAll(pattern)) {
      const entries = calls.get(match[1]) ?? [];
      entries.push(relative(cwd, join(cwd, file)).replaceAll("\\", "/"));
      calls.set(match[1], entries);
    }
  }
}

const definitions = new Map();
const definitionPattern = /create\s+or\s+replace\s+function\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi;
for (const file of migrationFiles) {
  const source = readFileSync(join(cwd, file), "utf8");
  for (const match of source.matchAll(definitionPattern)) {
    const entries = definitions.get(match[1]) ?? [];
    entries.push(relative(cwd, join(cwd, file)).replaceAll("\\", "/"));
    definitions.set(match[1], entries);
  }
}

const missing = [...calls.keys()]
  .filter((name) => !definitions.has(name))
  .sort()
  .map((name) => ({ name, callers: [...new Set(calls.get(name))] }));

const result = {
  rpcCallCount: calls.size,
  migrationFunctionCount: definitions.size,
  missingCount: missing.length,
  rpcNames: [...calls.keys()].sort(),
  missing,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = missing.length === 0 ? 0 : 1;
