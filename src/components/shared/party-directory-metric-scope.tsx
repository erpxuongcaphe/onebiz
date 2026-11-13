"use client";

import { directoryMetricScopeLabel } from "@/lib/services/supabase/party-directory-model";
import type { PartyDirectoryScopeV2 } from "@/lib/services/supabase/party-directory-reader";

/** Show the actual metric scopes, which may differ from each other. */
export function PartyDirectoryMetricScope({ scope, branches, kind }: {
  scope: PartyDirectoryScopeV2;
  branches: ReadonlyArray<{ id: string; name: string }>;
  kind: "customer" | "supplier";
}) {
  return <section aria-label="Phạm vi số liệu" className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
    <p><strong>{kind === "customer" ? "Doanh số khách hàng" : "Tổng mua nhà cung cấp"}:</strong>{" "}
      {directoryMetricScopeLabel(scope, "activity", branches)}</p>
    <p><strong>Công nợ:</strong>{" "}{directoryMetricScopeLabel(scope, "debt", branches)}</p>
    <p className="mt-1 text-xs">Mỗi số liệu và tổng chỉ tính các chi nhánh được cấp quyền tương ứng.</p>
  </section>;
}
