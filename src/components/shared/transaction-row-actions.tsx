"use client";

/**
 * TransactionRowActions — Standardized row actions cho list page giao dịch.
 *
 * Sprint UX-1 Stage 2 (CEO 04/05/2026): chuẩn hoá row actions toàn web sau
 * audit phát hiện 17/18 page thiếu Sao chép, 18/18 thiếu Audit log shortcut,
 * etc. Component này:
 * - Pull standardized 9 actions theo CEO request
 * - Tự ẩn/hiện theo `kind` + `row.status` + `permissions`
 * - Thứ tự nhất quán: Xem → Sửa → Sao chép → In → Xuất → Workflow → Trả/Nợ → Audit → Hủy
 *
 * Usage:
 * ```tsx
 * import { buildTransactionRowActions, type TxKind } from "@/components/shared/transaction-row-actions";
 *
 * <DataTable
 *   ...
 *   rowActions={(row) => buildTransactionRowActions({
 *     row,
 *     kind: "invoice",
 *     onView: () => setViewing(row),
 *     onDuplicate: () => duplicateInvoice(row.id),
 *     onEdit: () => setEditing(row),
 *     onPrint: () => printInvoice(row),
 *     onCancel: () => setCancelling(row),
 *     onAuditLog: () => setAuditOpen({entityType: "invoice", entityId: row.id}),
 *     workflowActions: row.status === "draft" ? [...] : [],
 *   })}
 * />
 * ```
 *
 * Pattern này thay thế 17+ page tự build rowActions inline (mỗi page khác).
 * Sau khi apply tất cả page → consistent UX, dễ maintain, dễ thêm permission gate.
 */

import type { ReactNode } from "react";
import type { RowAction } from "./data-table/data-table";
import { Icon } from "@/components/ui/icon";

// ─────────────────────────────────────────
// Transaction kinds (15 loại)
// ─────────────────────────────────────────
export type TxKind =
  // Sales
  | "sales_order"      // Đặt hàng
  | "invoice"          // Hoá đơn bán hàng
  | "sales_return"     // Trả hàng (sales return)
  | "shipping"         // Vận đơn
  // Purchase
  | "purchase_order"   // Đặt hàng nhập
  | "goods_receipt"    // Nhập kho
  | "purchase_return"  // Trả hàng nhập
  | "input_invoice"    // Hoá đơn đầu vào
  // Stock
  | "stock_transfer"   // Chuyển kho
  | "inventory_check"  // Kiểm kê
  | "disposal"         // Xuất hủy
  | "internal_export"  // Xuất nội bộ
  | "internal_sale"    // Bán nội bộ
  // Production
  | "production"       // Sản xuất
  // Financial
  | "cash_transaction"; // Sổ quỹ

// ─────────────────────────────────────────
// Action callbacks (tất cả optional — page chỉ wire actions cần)
// ─────────────────────────────────────────
export interface TransactionRowActionsArgs<TRow = Record<string, unknown>> {
  /** Row data — page tự type, component không enforce shape */
  row: TRow;
  /** Loại giao dịch — quyết định actions nào hiện. */
  kind: TxKind;

  /** 👁 Xem chi tiết (view-only) — thường mở dialog/drawer detail. */
  onView?: () => void;
  /** 📋 Sao chép — duplicate phiếu, tạo bản mới với cùng items. */
  onDuplicate?: () => void;
  /** ✏️ Sửa — open edit dialog. Page tự check status. */
  onEdit?: () => void;
  /** 🖨 In phiếu/hoá đơn theo template. */
  onPrint?: () => void;
  /** 📤 Xuất file (PDF/Excel) per row. */
  onExport?: () => void;
  /** ↩️ Trả hàng / hoàn — tạo phiếu trả/refund. */
  onReturn?: () => void;
  /** 💰 Thu/Trả nợ — record payment cho row có debt. */
  onPayment?: () => void;
  /** 📜 Audit log — mở dialog hiển thị lịch sử thay đổi. */
  onAuditLog?: () => void;
  /** 🚫 Hủy — cancel phiếu (status='cancelled', không xoá cứng). */
  onCancel?: () => void;

  /**
   * Workflow actions — status transitions specific cho từng kind.
   * Vd: PO "Xác nhận đặt hàng → Nhập một phần → Hoàn thành".
   * Render giữa Xuất và Trả/Nợ.
   */
  workflowActions?: Array<{
    label: string;
    icon?: ReactNode;
    onClick: () => void;
  }>;

  /**
   * Permission map — ẩn action không có quyền. Nếu undefined → show hết
   * (backward compat). Sprint UX-1 Stage 6 wire usePermissions().
   */
  permissions?: {
    canView?: boolean;
    canDuplicate?: boolean;
    canEdit?: boolean;
    canPrint?: boolean;
    canExport?: boolean;
    canReturn?: boolean;
    canPayment?: boolean;
    canAuditLog?: boolean;
    canCancel?: boolean;
  };

  /**
   * Custom extra actions — page-specific không nằm trong 9 standard.
   * Vd: "Gửi nhắc nợ" cho công nợ. Render trước Hủy.
   */
  extraActions?: RowAction<TRow>[];
}

// ─────────────────────────────────────────
// Builder — return RowAction[] cho DataTable rowActions prop
// ─────────────────────────────────────────
export function buildTransactionRowActions<TRow>(
  args: TransactionRowActionsArgs<TRow>,
): RowAction<TRow>[] {
  const {
    onView,
    onDuplicate,
    onEdit,
    onPrint,
    onExport,
    onReturn,
    onPayment,
    onAuditLog,
    onCancel,
    workflowActions = [],
    extraActions = [],
    permissions,
  } = args;

  // Default tất cả permissions = true nếu không pass (backward compat)
  const can = (key: keyof NonNullable<typeof permissions>) =>
    !permissions || permissions[key] !== false;

  const actions: RowAction<TRow>[] = [];

  // 1. Xem chi tiết
  if (onView && can("canView")) {
    actions.push({
      label: "Xem chi tiết",
      icon: <Icon name="visibility" size={16} />,
      onClick: onView,
    });
  }

  // 2. Sửa
  if (onEdit && can("canEdit")) {
    actions.push({
      label: "Sửa",
      icon: <Icon name="edit" size={16} />,
      onClick: onEdit,
    });
  }

  // 3. Sao chép (CEO ưu tiên cao)
  if (onDuplicate && can("canDuplicate")) {
    actions.push({
      label: "Sao chép",
      icon: <Icon name="content_copy" size={16} />,
      onClick: onDuplicate,
    });
  }

  // 4. In phiếu
  if (onPrint && can("canPrint")) {
    actions.push({
      label: "In phiếu",
      icon: <Icon name="print" size={16} />,
      onClick: onPrint,
    });
  }

  // 5. Xuất file
  if (onExport && can("canExport")) {
    actions.push({
      label: "Xuất file",
      icon: <Icon name="download" size={16} />,
      onClick: onExport,
    });
  }

  // 6. Workflow actions (separator above)
  if (workflowActions.length > 0) {
    workflowActions.forEach((wf, i) => {
      actions.push({
        label: wf.label,
        icon: wf.icon ?? <Icon name="arrow_forward" size={16} />,
        onClick: wf.onClick,
        separator: i === 0, // separator ở action đầu của workflow group
      });
    });
  }

  // 7. Trả hàng / Hoàn
  if (onReturn && can("canReturn")) {
    actions.push({
      label: "Trả hàng",
      icon: <Icon name="undo" size={16} />,
      onClick: onReturn,
      separator: workflowActions.length === 0, // tách khỏi nhóm trên nếu chưa có separator
    });
  }

  // 8. Thu/Trả nợ
  if (onPayment && can("canPayment")) {
    actions.push({
      label: "Thu/Trả nợ",
      icon: <Icon name="payments" size={16} />,
      onClick: onPayment,
    });
  }

  // 9. Audit log shortcut
  if (onAuditLog && can("canAuditLog")) {
    actions.push({
      label: "Lịch sử thay đổi",
      icon: <Icon name="history" size={16} />,
      onClick: onAuditLog,
      separator: true,
    });
  }

  // Custom extras (vd "Gửi nhắc nợ" cho cong-no)
  extraActions.forEach((extra) => actions.push(extra));

  // 10. Hủy (cuối cùng, destructive)
  if (onCancel && can("canCancel")) {
    actions.push({
      label: "Hủy",
      icon: <Icon name="cancel" size={16} />,
      onClick: onCancel,
      variant: "destructive",
      separator: extraActions.length === 0 && !onAuditLog, // separator nếu chưa có
    });
  }

  return actions;
}
