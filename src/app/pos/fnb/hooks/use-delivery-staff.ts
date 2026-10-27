import { useCallback, useEffect, useState } from "react";
import { listFnbDeliveryStaff, type FnbDeliveryStaff } from "@/lib/services/supabase/fnb-delivery-staff";

export function useDeliveryStaff(branchId: string | null | undefined, actorId?: string) {
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const [state, setState] = useState<{ scope: string; rows: FnbDeliveryStaff[]; error: boolean }>({ scope: "", rows: [], error: false });
  const scope = `${actorId ?? ""}:${branchId ?? ""}:${revision}`;
  useEffect(() => {
    let cancelled = false;
    if (branchId) void listFnbDeliveryStaff(branchId).then(rows => {
      if (!cancelled) setState({ scope, rows, error: false });
    }).catch(() => {
      if (!cancelled) setState({ scope, rows: [], error: true });
    });
    return () => { cancelled = true; };
  }, [scope, branchId, revision]);
  // Never expose another branch/user's previous rows, even before effect cleanup.
  const current = state.scope === scope;
  return { options: current ? state.rows : [], loading: Boolean(branchId) && !current, error: current && state.error, retry };
}
