#!/usr/bin/env node
/**
 * Add `getCurrentTenantId` mock to all test files that mock @/lib/services/supabase/base.
 * Idempotent — skips files that already have the mock.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function findFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findFiles(full, files);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = findFiles("src/__tests__");
let updated = 0;
let skipped = 0;

for (const file of allFiles) {
  const content = readFileSync(file, "utf8");
  if (!content.includes('vi.mock("@/lib/services/supabase/base"')) {
    skipped++;
    continue;
  }
  if (content.includes("getCurrentTenantId")) {
    skipped++;
    continue;
  }

  let newContent = content;
  if (newContent.includes("getCurrentContext:")) {
    newContent = newContent.replace(
      /(getCurrentContext:[\s\S]*?\),\n)/,
      `$1  getCurrentTenantId: () => Promise.resolve("t1"),\n`
    );
  } else if (newContent.includes("getPaginationRange:")) {
    newContent = newContent.replace(
      /(getPaginationRange:[^,\n]+,\n)/,
      `$1  getCurrentTenantId: () => Promise.resolve("t1"),\n`
    );
  } else if (newContent.includes("handleError:")) {
    newContent = newContent.replace(
      /(  handleError:)/,
      `  getCurrentTenantId: () => Promise.resolve("t1"),\n$1`
    );
  } else {
    skipped++;
    console.log(`  skip (no anchor): ${file}`);
    continue;
  }

  if (newContent === content) {
    skipped++;
    console.log(`  skip (no change): ${file}`);
    continue;
  }

  writeFileSync(file, newContent);
  updated++;
  console.log(`  ✓ ${file}`);
}

console.log(`\nUpdated: ${updated}, skipped: ${skipped}`);
