import { readFileSync } from "node:fs";
import { join } from "node:path";

export const privateContractPath = "supabase/contracts/private-rpcs.json";

export function validatePrivateRpcContracts(manifest) {
  const identifier = /^[a-z][a-z0-9_]*$/;
  if (manifest?.schemaVersion !== 1 || (manifest.additionalMigrations !== undefined
    && !Array.isArray(manifest.additionalMigrations))) {
    throw new Error("Invalid private RPC contract manifest");
  }
  const names = new Set();
  const migrations = new Set();
  return [manifest, ...(manifest.additionalMigrations ?? [])].flatMap((bundle) => {
    if (!identifier.test(bundle?.migration ?? "") || migrations.has(bundle.migration)
      || !/^[a-f0-9]{64}$/.test(bundle.migrationSha256 ?? "")
      || !Array.isArray(bundle.functions) || bundle.functions.length === 0) {
      throw new Error("Invalid private RPC migration bundle");
    }
    migrations.add(bundle.migration);
    return bundle.functions.map((entry) => {
      if (!identifier.test(entry?.name ?? "") || names.has(entry.name) || !Array.isArray(entry.params)) {
        throw new Error("Invalid or duplicate private RPC name");
      }
      names.add(entry.name);
      const params = new Set();
      let optionalSeen = false;
      for (const parameter of entry.params) {
        if (!identifier.test(parameter?.name ?? "") || params.has(parameter.name)
          || typeof parameter.optional !== "boolean" || (optionalSeen && !parameter.optional)) {
          throw new Error("Invalid private RPC parameter declaration");
        }
        params.add(parameter.name);
        optionalSeen ||= parameter.optional;
      }
      return { name: entry.name, params: entry.params, file: privateContractPath };
    });
  });
}

export function readPrivateRpcContracts(root = process.cwd()) {
  return validatePrivateRpcContracts(JSON.parse(readFileSync(join(root, privateContractPath), "utf8")));
}
