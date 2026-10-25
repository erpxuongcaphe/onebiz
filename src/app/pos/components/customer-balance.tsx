"use client";

import { useCallback } from "react";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { useListWorkspaceQuery } from "@/lib/hooks/use-list-workspace-query";
import { getPosCustomerBalance } from "@/lib/services/supabase/pos-customer-balance";
import { formatCurrency } from "@/lib/format";

export function CustomerBalance({ customerId, branchId }: { customerId: string; branchId?: string }) {
  const { user, tenant, hasPermission } = useAuth();
  const enabled = Boolean(user?.id && tenant?.id && branchId && hasPermission(PERMISSIONS.CUSTOMERS_VIEW_DEBT));
  const load = useCallback(() => getPosCustomerBalance(customerId, branchId ?? ""), [customerId, branchId]);
  const { data, loading, error, refresh } = useListWorkspaceQuery(load, enabled, `${tenant?.id}:${user?.id}`);
  if (!enabled || data?.canViewDebt === false) return null;
  if (loading) return <span className="text-xs text-muted-foreground">Đang tải công nợ...</span>;
  if (error) return <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-xs text-status-error">
    Chưa tải được công nợ.<button type="button" onClick={() => void refresh()} className="min-h-9 font-medium underline">Thử lại</button>
  </span>;
  if (!data || (data.debt === 0 && data.advance === 0)) return null;
  return <span className="inline-flex flex-wrap items-center gap-3 text-xs" aria-label="Công nợ tại chi nhánh đang bán">
    {data.debt! > 0 && <span className="font-semibold text-status-error">Còn nợ: {formatCurrency(data.debt)}đ</span>}
    {data.advance! > 0 && <span className="font-medium text-status-success">Ứng còn: {formatCurrency(data.advance)}đ</span>}
  </span>;
}
