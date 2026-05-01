/**
 * Notifications Service (Sprint NB-1)
 *
 * Trước đây trang `/thong-bao` hardcode 20 mock notifications + state
 * setState mark-as-read không persist DB. Schema `notifications` đã có
 * sẵn từ migration 00001 nhưng KHÔNG có service file → inbox luôn rỗng
 * trên production sau khi xóa mock.
 *
 * Service này wire CRUD đầy đủ:
 *   - getNotifications(filters) — list theo user + tenant + tab type
 *   - getUnreadCount() — cho badge bell sidebar
 *   - markAsRead(id) — single notification
 *   - markAllAsRead() — bulk all unread của user hiện tại
 *   - deleteNotification(id) — soft delete (UPDATE archived_at) hoặc hard
 *
 * Note: notifications table chưa có cột `archived_at` → hard delete (DB
 * cleanup sẽ là cron job sau N ngày).
 *
 * Realtime: page sẽ subscribe `postgres_changes` qua hook riêng — service
 * này chỉ expose CRUD HTTP.
 */

import {
  getClient,
  getCurrentTenantId,
  getCurrentContext,
  handleError,
} from "./base";

export type NotificationKind =
  | "order_new"
  | "order_completed"
  | "stock_low"
  | "customer_new"
  | "payment_received"
  | "expiring_lot"
  | "po_overdue"
  | "cash_drawer_diff"
  | "pos_offline"
  | string; // server có thể sinh kind mới — không strict union

export interface NotificationRow {
  id: string;
  type: NotificationKind;
  title: string;
  description?: string;
  isRead: boolean;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
}

/**
 * List notifications của user hiện tại trong tenant.
 *
 * @param onlyUnread — true → chỉ lấy chưa đọc (cho tab "Chưa đọc").
 * @param types — filter theo kind (cho tab Đơn hàng / Kho / Tài chính).
 * @param limit — default 100. Cà phê chain ít notification, không cần
 *   pagination phức tạp.
 */
export async function getNotifications(params?: {
  onlyUnread?: boolean;
  types?: NotificationKind[];
  limit?: number;
}): Promise<NotificationRow[]> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  let query = supabase
    .from("notifications")
    .select("id, type, title, description, is_read, reference_type, reference_id, created_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(params?.limit ?? 100);

  if (params?.onlyUnread) {
    query = query.eq("is_read", false);
  }
  if (params?.types && params.types.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.in("type", params.types as any);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[getNotifications]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description ?? undefined,
    isRead: row.is_read,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
    createdAt: row.created_at,
  }));
}

/**
 * Đếm số notification chưa đọc — cho badge bell ở sidebar.
 *
 * Trả 0 nếu lỗi (không bể UI).
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .eq("is_read", false);

  if (error) {
    console.warn("[getUnreadNotificationCount]", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Mark single notification as read. Filter theo user_id + tenant_id để
 * tránh user khác mark-read notification của mình (defense-in-depth).
 */
export async function markNotificationAsRead(id: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { error } = await supabase
    .from("notifications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ is_read: true } as any)
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .eq("id", id);

  if (error) handleError(error, "markNotificationAsRead");
}

/**
 * Mark TẤT CẢ notification chưa đọc của user hiện tại làm đã đọc.
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { error } = await supabase
    .from("notifications")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ is_read: true } as any)
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .eq("is_read", false);

  if (error) handleError(error, "markAllNotificationsAsRead");
}

/**
 * Delete (hard) notification.
 *
 * Schema chưa có archived_at → hard delete. Khi cần soft delete (audit
 * trail) sẽ thêm cột.
 */
export async function deleteNotification(id: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .eq("id", id);

  if (error) handleError(error, "deleteNotification");
}

/**
 * Tạo notification cho user (helper cho server actions / triggers
 * tương lai). Phía FE hiếm gọi trực tiếp — chỉ wrapper insert.
 */
export async function createNotification(input: {
  userId: string;
  type: NotificationKind;
  title: string;
  description?: string;
  referenceType?: string;
  referenceId?: string;
}): Promise<NotificationRow | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      tenant_id: tenantId,
      user_id: input.userId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .select("id, type, title, description, is_read, reference_type, reference_id, created_at")
    .single();

  if (error) {
    console.warn("[createNotification]", error.message);
    return null;
  }

  return {
    id: data.id,
    type: data.type as NotificationKind,
    title: data.title,
    description: data.description ?? undefined,
    isRead: data.is_read,
    referenceType: data.reference_type ?? undefined,
    referenceId: data.reference_id ?? undefined,
    createdAt: data.created_at,
  };
}
