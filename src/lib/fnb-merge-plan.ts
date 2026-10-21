import { isUnpaidFnbOrder, type FnbOpenOrder } from "./fnb-open-orders";

export function canMergeFnbOrder(order: FnbOpenOrder, branchId: string): boolean {
  return order.branchId === branchId && isUnpaidFnbOrder(order)
    && (order.orderType === "dine_in" ? Boolean(order.tableId) : order.orderType === "takeaway" && !order.tableId)
    && !order.deliveryFee && !order.platformCommission && !order.platformCommissionPercent;
}
export function getFnbMergePlan(orders: FnbOpenOrder[], ids: string[], targetId: string, branchId: string, pendingIds: string[] = []) {
  if (ids.length < 2) return { error: "Chọn ít nhất 2 bill để gộp." } as const;
  if (ids.length > 50) return { error: "Mỗi lần gộp tối đa 50 bill." } as const;
  if (new Set(ids).size !== ids.length) return { error: "Danh sách bill bị trùng. Chọn lại bill." } as const;
  const selected = ids.map(id => orders.find(order => order.id === id));
  if (selected.some(order => !order || !canMergeFnbOrder(order, branchId))) return { error: "Có bill đã thay đổi hoặc không còn được gộp. Làm mới và chọn lại." } as const;
  const checks = selected as FnbOpenOrder[];
  if (checks.some(order => pendingIds.includes(order.id))) return { error: "Có món chưa gửi bếp trên bill đã chọn. Gửi hoặc bỏ món đang chờ trước khi gộp." } as const;
  const target = checks.find(order => order.id === targetId);
  if (!target) return { error: "Chọn một bill giữ lại trong các bill đã tích." } as const;
  if (checks.some(order => !Number.isFinite(order.provisionalTotal) || order.provisionalTotal < 0)) return { error: "Chưa đọc được giá trị bill. Làm mới trước khi gộp." } as const;
  return { target, sources: checks.filter(order => order.id !== target.id), selected: checks,
    total: checks.reduce((sum, order) => sum + order.provisionalTotal, 0),
    discount: checks.reduce((sum, order) => sum + (order.discountAmount || 0), 0),
    differentCustomers: checks.some(order => (order.customerId || null) !== (target.customerId || null)), error: null } as const;
}
