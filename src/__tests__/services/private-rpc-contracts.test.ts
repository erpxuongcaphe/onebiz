import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function validate(mutation: string) {
  return () => execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    import { validatePrivateRpcContracts } from './scripts/private-rpc-contracts.mjs';
    const manifest = JSON.parse(readFileSync('supabase/contracts/private-rpcs.json', 'utf8'));
    ${mutation}
    validatePrivateRpcContracts(manifest);
  `], { stdio: "pipe" });
}

describe("private RPC interface declarations", () => {
  it("accepts the versioned interface without publishing SQL bodies", () => {
    expect(validate("")).not.toThrow();
  });

  it.each([
    "manifest.schemaVersion = 2;",
    "delete manifest.migrationSha256;",
    "manifest.functions.push(manifest.functions[0]);",
    "manifest.functions[0].params[0].optional = 'false';",
    "manifest.functions[0].params[1].name = manifest.functions[0].params[0].name;",
    "manifest.functions[0].params[0].optional = true;",
    "manifest.additionalMigrations = {};",
    "manifest.additionalMigrations[0].migration = manifest.migration;",
    "manifest.additionalMigrations[0].migrationSha256 = 'invalid';",
    "manifest.additionalMigrations[0].functions.push(manifest.functions[0]);",
  ])("rejects malformed metadata: %s", (mutation) => {
    expect(validate(mutation)).toThrow();
  });
});
