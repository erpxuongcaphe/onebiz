# Private RPC Interfaces

`private-rpcs.json` declares client-callable interfaces whose implementation is
managed outside the public repository. It contains no SQL bodies or company data.

Static audits check names and required/optional parameters from this manifest in
addition to public migrations. This is an interface check, not evidence that the
functions have been installed or that permission tests passed.

Release gates remain mandatory:

1. The private SQL package SHA-256 must match `migrationSha256`.
2. Disposable PostgreSQL tests must install that exact package and compare its
   `pg_proc` argument metadata with every manifest entry, then test behavior.
3. Hosted CI must pass for the selected application commit.
4. Apply the private migration before switching the application consumers.
5. Verify installed signatures, grants, and branch/role behavior before rollout.

Do not add placeholder SQL implementations to public migrations, treat missing
functions as empty results, or bypass access-denied errors with legacy readers.
