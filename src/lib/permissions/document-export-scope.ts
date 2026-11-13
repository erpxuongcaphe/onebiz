/** A direct invoice-export grant and the existing report-export grant both
 * permit exporting invoices. Other reporting permissions are unaffected. */
export function invoiceExportableBranches(
  branches: readonly {id:string}[],
  hasAtBranch: (code:string, branchId:string) => boolean,
) {
  return documentExportableBranches(branches,hasAtBranch,"invoices.export");
}

export function documentExportableBranches(
  branches: readonly {id:string}[],
  hasAtBranch: (code:string, branchId:string) => boolean,
  documentPermission: "invoices.export" | "orders.export",
) {
  return branches.filter(branch => hasAtBranch(documentPermission, branch.id)
    || hasAtBranch("reports.export", branch.id)).map(branch => branch.id).sort();
}

export function documentRowsExportable(
  rows: readonly {branchId?:string | null}[],
  branches: readonly string[],
) {
  const allowed = new Set(branches);
  return rows.every(row => !!row.branchId && allowed.has(row.branchId));
}
