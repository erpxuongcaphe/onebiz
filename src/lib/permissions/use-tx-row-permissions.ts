"use client";

/**
 * useTxRowPermissions — derive row action permissions per TxKind từ user permissions.
 *
 * Sprint UX-1 Stage 6 (CEO 04/05/2026): wire RBAC permissions vào
 * TransactionRowActions builder. Trước đây mọi user thấy tất cả actions
 * (Hủy, Sửa, Xóa) → kế toán có thể bấm Hủy đơn của thủ kho, etc.
 *
 * Hook này map TxKind → permission codes tương ứng → return shape
 * compatible với builder's `permissions` prop.
 *
 * Usage:
 * ```tsx
 * import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
 * import { useTxRowPermissions } from "@/lib/permissions/use-tx-row-permissions";
 *
 * const txPerms = useTxRowPermissions("invoice");
 *
 * <DataTable
 *   rowActions={(row) => buildTransactionRowActions({
 *     row, kind: "invoice",
 *     onView, onEdit, ...
 *     permissions: txPerms,
 *   })}
 * />
 * ```
 */

import { usePermissions } from "./use-permission";
import { PERMISSIONS } from "./constants";
import type { TxKind } from "@/components/shared/transaction-row-actions";

export interface TxRowPermissions {
  canView: boolean;
  canDuplicate: boolean;
  canEdit: boolean;
  canPrint: boolean;
  canExport: boolean;
  canReturn: boolean;
  canPayment: boolean;
  canAuditLog: boolean;
  canCancel: boolean;
}

/**
 * Map mỗi TxKind → permission codes cần check cho từng action.
 * Owner luôn có hết (handled trong usePermissions hasPermission).
 */
const PERMISSION_MAP: Record<
  TxKind,
  Partial<Record<keyof TxRowPermissions, string | string[]>>
> = {
  // SALES
  sales_order: {
    canView: PERMISSIONS.ORDERS_VIEW,
    canEdit: PERMISSIONS.ORDERS_CREATE,
    canDuplicate: PERMISSIONS.ORDERS_CREATE,
    canPrint: PERMISSIONS.ORDERS_VIEW,
    canExport: PERMISSIONS.REPORTS_EXPORT,
    canCancel: PERMISSIONS.ORDERS_CANCEL,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  invoice: {
    canView: PERMISSIONS.ORDERS_VIEW,
    canEdit: PERMISSIONS.POS_RETAIL_CHECKOUT,
    canDuplicate: PERMISSIONS.POS_RETAIL_CHECKOUT,
    canPrint: PERMISSIONS.ORDERS_VIEW,
    canExport: PERMISSIONS.REPORTS_EXPORT,
    canReturn: PERMISSIONS.POS_RETAIL_VOID,
    canPayment: PERMISSIONS.FINANCE_CREATE_TRANSACTION,
    canCancel: PERMISSIONS.POS_RETAIL_VOID,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  sales_return: {
    canView: PERMISSIONS.ORDERS_VIEW,
    canPrint: PERMISSIONS.ORDERS_VIEW,
    canCancel: PERMISSIONS.POS_RETAIL_VOID,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  shipping: {
    canView: PERMISSIONS.ORDERS_VIEW,
    canEdit: PERMISSIONS.ORDERS_CREATE,
    canPrint: PERMISSIONS.ORDERS_VIEW,
    canCancel: PERMISSIONS.ORDERS_CANCEL,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },

  // PURCHASE
  purchase_order: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canEdit: PERMISSIONS.INVENTORY_CREATE_PO,
    canDuplicate: PERMISSIONS.INVENTORY_CREATE_PO,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canExport: PERMISSIONS.REPORTS_EXPORT,
    canCancel: PERMISSIONS.INVENTORY_CREATE_PO,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  goods_receipt: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canEdit: PERMISSIONS.INVENTORY_CREATE_PO,
    canDuplicate: PERMISSIONS.INVENTORY_CREATE_PO,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canReturn: PERMISSIONS.INVENTORY_ADJUST,
    canPayment: PERMISSIONS.FINANCE_CREATE_TRANSACTION,
    canCancel: PERMISSIONS.INVENTORY_ADJUST,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  purchase_return: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  input_invoice: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canCancel: PERMISSIONS.INVENTORY_ADJUST,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },

  // STOCK
  stock_transfer: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canCancel: PERMISSIONS.INVENTORY_TRANSFER,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  inventory_check: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canCancel: PERMISSIONS.INVENTORY_CHECK,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  disposal: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canCancel: PERMISSIONS.INVENTORY_DISPOSE,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  internal_export: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canCancel: PERMISSIONS.INVENTORY_INTERNAL_EXPORT,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
  internal_sale: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canCancel: PERMISSIONS.INVENTORY_INTERNAL_EXPORT,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },

  // PRODUCTION
  production: {
    canView: PERMISSIONS.INVENTORY_VIEW,
    canPrint: PERMISSIONS.INVENTORY_VIEW,
    canCancel: PERMISSIONS.INVENTORY_ADJUST,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },

  // FINANCIAL
  cash_transaction: {
    canView: PERMISSIONS.FINANCE_VIEW_CASH_BOOK,
    canPrint: PERMISSIONS.FINANCE_VIEW_CASH_BOOK,
    canCancel: PERMISSIONS.FINANCE_VOID_TRANSACTION,
    canAuditLog: PERMISSIONS.SYSTEM_VIEW_AUDIT,
  },
};

export function useTxRowPermissions(kind: TxKind): TxRowPermissions {
  const { hasPermission } = usePermissions();
  const map = PERMISSION_MAP[kind];

  const check = (code: string | string[] | undefined, fallback = true): boolean => {
    if (code === undefined) return fallback;
    if (Array.isArray(code)) return code.every((c) => hasPermission(c));
    return hasPermission(code);
  };

  return {
    canView: check(map.canView),
    canDuplicate: check(map.canDuplicate),
    canEdit: check(map.canEdit),
    canPrint: check(map.canPrint),
    canExport: check(map.canExport),
    canReturn: check(map.canReturn),
    canPayment: check(map.canPayment),
    canAuditLog: check(map.canAuditLog),
    canCancel: check(map.canCancel),
  };
}
