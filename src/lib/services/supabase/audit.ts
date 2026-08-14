/**
 * Supabase service: Audit Log (Lịch sử thao tác)
 *
 * Sprint 7 "Toàn Cảnh"
 *
 * Reads from `audit_log` table (created by triggers in 00001_initial_schema).
 * Provides filtered, paginated queries for the audit page.
 */

import type { QueryParams, QueryResult } from "@/lib/types";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";
import {
  getClient,
  getPaginationRange,
  handleError,
  getCurrentContext,
  getCurrentTenantId,
} from "./base";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityTypeLabel: string;
  entityId: string;
  entityName: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditFilters {
  action?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
}

/* ------------------------------------------------------------------ */
/*  Label maps (Vietnamese)                                            */
/* ------------------------------------------------------------------ */

const ACTION_LABELS: Record<string, string> = {
  create: "Tạo mới",
  update: "Cập nhật",
  delete: "Xóa",
  complete: "Hoàn thành",
  cancel: "Hủy",
  approve: "Duyệt",
  receive: "Nhập hàng",
  return: "Trả hàng",
  transfer: "Chuyển kho",
  update_status: "Đổi trạng thái",
  opening_debt_import: "Nhập công nợ đầu kỳ",
  role_grant: "Cấp quyền",
  role_revoke: "Gỡ quyền",
  auto_reset: "Tự mất khách",
  close_short: "Chốt nhập thiếu",
  close_purchase_order_short: "Chốt đơn nhập thiếu",
  complete_payment: "Hoàn tất thanh toán",
  record_invoice_payment: "Ghi nhận thanh toán hóa đơn",
  record_purchase_payment: "Ghi nhận thanh toán đơn nhập",
  discount_applied: "Áp dụng giảm giá",
  customer_code_changed: "Đổi mã khách hàng",
  cash_transaction_created: "Tạo phiếu thu/chi",
  cash_transaction_cancelled: "Hủy phiếu thu/chi",
  purchase_order_save_draft: "Lưu nháp đơn nhập hàng",
  purchase_order_save_and_receive: "Lưu và nhập kho",
  purchase_order_status_change: "Đổi trạng thái đơn nhập hàng",
  purchase_order_received_update: "Cập nhật đơn đã nhập",
  purchase_order_revert: "Hoàn tác nhập hàng",
  purchase_receive: "Nhận hàng",
  purchase_receive_revert: "Hoàn tác nhận hàng",
  purchase_price_update: "Cập nhật giá nhập",
  sales_order_created: "Tạo đơn đặt hàng",
  sales_order_updated: "Cập nhật đơn đặt hàng",
  legacy_sales_order_completed: "Hoàn thành đơn đặt hàng cũ",
  legacy_sales_order_cancelled: "Hủy đơn đặt hàng cũ",
  invoice_draft_updated: "Cập nhật hóa đơn nháp",
  invoice_draft_cancelled: "Hủy hóa đơn nháp",
  invoice_duplicated_to_order: "Sao chép hóa đơn thành đơn đặt hàng",
  pos_draft_completed: "Hoàn tất đơn nháp POS",
  pos_checkout_completed: "Hoàn tất thanh toán POS",
  void_paid_invoice: "Hủy hóa đơn đã thanh toán",
  attach_shipment: "Gắn vận đơn",
  shipping_settlement: "Đối soát vận đơn",
  create_sales_return_atomic: "Tạo phiếu trả hàng",
  create_supplier_return_atomic: "Tạo phiếu trả nhà cung cấp",
  create_internal_sale_atomic: "Tạo bán hàng nội bộ",
  stock_export_created: "Tạo phiếu xuất kho",
  stock_export_cancelled: "Hủy phiếu xuất kho",
  create_and_apply: "Tạo và áp dụng",
  apply_inventory_check_atomic: "Áp dụng kiểm kho",
  complete_stock_transfer_atomic: "Hoàn tất chuyển kho",
  manual_stock_movement: "Điều chỉnh kho thủ công",
  create_adjustment_lot: "Tạo lô điều chỉnh",
  cost_price_update: "Cập nhật giá vốn",
  cost_price_revert: "Hoàn tác giá vốn",
  fnb_send_to_kitchen: "Gửi bếp",
  fnb_add_kitchen_items: "Bổ sung món gửi bếp",
  fnb_complete_payment_atomic: "Hoàn tất thanh toán FnB",
  fnb_split_bill: "Tách hóa đơn FnB",
  fnb_transfer_table: "Chuyển bàn FnB",
  fnb_merge_orders: "Gộp đơn FnB",
  fnb_table_available: "Trả bàn về trạng thái trống",
  fnb_kitchen_item_status: "Đổi trạng thái món bếp",
  fnb_kitchen_order_served: "Hoàn tất phục vụ món",
  fnb_delivery_staff_assigned: "Phân công giao hàng",
  fnb_delivery_staff_unassigned: "Gỡ người giao hàng",
  fnb_delivery_completed: "Hoàn tất giao hàng",
  fnb_delivery_pricing_updated: "Cập nhật phí giao hàng",
  input_invoice_recorded: "Ghi nhận hóa đơn đầu vào",
  input_invoice_cancelled: "Hủy hóa đơn đầu vào",
  internal_sale_cancelled: "Hủy bán hàng nội bộ",
  cleanup_test_data: "Dọn dữ liệu kiểm thử",
  legacy_topping: "Ghi nhận topping cũ",
  soft_delete: "Xóa mềm",
  payment: "Ghi nhận thanh toán",
  mkt_campaign_created: "Tạo chiến dịch MKT",
  mkt_campaign_updated: "Cập nhật chiến dịch MKT",
  mkt_campaign_status_changed: "Đổi trạng thái chiến dịch MKT",
  mkt_campaign_override: "Duyệt ngoại lệ chiến dịch MKT",
  mkt_campaign_plan_upsert: "Lưu kế hoạch chiến dịch MKT",
  mkt_work_package_created: "Tạo gói công việc MKT",
  mkt_work_package_split: "Chia gói công việc MKT",
  mkt_manual_task_created: "Tạo công việc MKT thủ công",
  mkt_task_accepted: "Chấp nhận công việc MKT",
  mkt_task_rejected: "Từ chối công việc MKT",
  mkt_task_need_discussion: "Yêu cầu trao đổi công việc MKT",
  mkt_task_started: "Bắt đầu công việc MKT",
  mkt_task_done: "Hoàn thành công việc MKT",
  mkt_task_force_done: "Buộc hoàn thành công việc MKT",
  mkt_task_reassigned: "Phân công lại công việc MKT",
  mkt_task_canceled: "Hủy công việc MKT",
  mkt_tasks_generated_from_plan: "Tạo công việc từ kế hoạch MKT",
  mkt_content_created: "Tạo nội dung MKT",
  mkt_content_submitted_review: "Gửi nội dung MKT để duyệt",
  mkt_content_reviewed: "Duyệt nội dung MKT",
  mkt_readiness_added: "Thêm điều kiện sẵn sàng MKT",
  mkt_readiness_confirmed: "Xác nhận điều kiện sẵn sàng MKT",
  mkt_readiness_waived: "Miễn điều kiện sẵn sàng MKT",
  mkt_readiness_reminded: "Nhắc điều kiện sẵn sàng MKT",
  mkt_pillar_upserted: "Lưu trụ cột nội dung MKT",
  mkt_pillar_deactivated: "Ngừng trụ cột nội dung MKT",
  mkt_pillar_angle_upserted: "Lưu góc nội dung MKT",
  mkt_pillar_angle_removed: "Gỡ góc nội dung MKT",
  mkt_media_registered: "Ghi nhận tư liệu MKT",
  mkt_media_removed: "Gỡ tư liệu MKT",
  mkt_media_status_changed: "Đổi trạng thái tư liệu MKT",
  mkt_document_registered: "Ghi nhận tài liệu MKT",
  mkt_document_status_changed: "Đổi trạng thái tài liệu MKT",
  mkt_document_removed: "Gỡ tài liệu MKT",
  mkt_channel_plan_assigned: "Phân công kế hoạch kênh MKT",
  mkt_channel_plan_saved: "Lưu kế hoạch kênh MKT",
  mkt_channel_plan_submitted: "Gửi duyệt kế hoạch kênh MKT",
  mkt_channel_plan_change_requested: "Yêu cầu sửa kế hoạch kênh MKT",
  mkt_telegram_link_token_created: "Tạo mã liên kết Telegram MKT",
  mkt_telegram_linked: "Liên kết Telegram MKT",
  mkt_telegram_unlinked: "Hủy liên kết Telegram MKT",
  mkt_team_pinged: "Nhắc thành viên MKT",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: "Hóa đơn",
  product: "Sản phẩm",
  customer: "Khách hàng",
  user: "Người dùng",
  role: "Vai trò",
  branch: "Chi nhánh",
  supplier: "Nhà cung cấp",
  purchase_order: "Đơn nhập hàng",
  cash_transaction: "Phiếu thu/chi",
  sales_order: "Đơn đặt hàng",
  stock_movement: "Phiếu kho",
  stock_transfer: "Chuyển kho",
  production_order: "Lệnh sản xuất",
  disposal_export: "Phiếu xuất hủy",
  internal_export: "Phiếu xuất nội bộ",
  return: "Phiếu trả hàng",
  input_invoice: "Hóa đơn đầu vào",
  internal_sale: "Bán hàng nội bộ",
  inventory_check: "Kiểm kho",
  purchase_return: "Phiếu trả hàng nhập",
  shipping_order: "Vận đơn",
  kitchen_order: "Đơn bếp",
  // 29/07: POS tự báo về khi khách trên màn hình bị gỡ ngoài ý muốn. Trước
  // đây hộp đen chỉ nằm ở máy nhân viên nên chủ quán không xem được — CEO
  // phải sang tận máy mới lấy được thông tin.
  pos_customer: "POS — khách tự mất",
  pos_draft: "Đơn nháp POS",
  price_tier: "Bảng giá",
  product_lot: "Lô hàng",
  restaurant_table: "Bàn FnB",
  kitchen_order_item: "Món trong đơn bếp",
  shipping_settlement: "Đối soát giao hàng",
  tenant_setting: "Thiết lập doanh nghiệp",
  stock_batch: "Lô tồn kho",
  sales_return: "Phiếu trả hàng",
  supplier_return: "Phiếu trả nhà cung cấp",
  mkt_campaign: "Chiến dịch MKT",
  mkt_campaign_plan: "Kế hoạch chiến dịch MKT",
  mkt_channel_plan: "Kế hoạch kênh MKT",
  mkt_work_package: "Gói công việc MKT",
  mkt_task: "Công việc MKT",
  mkt_content_item: "Nội dung MKT",
  mkt_readiness_item: "Điều kiện sẵn sàng MKT",
  mkt_content_pillar: "Trụ cột nội dung MKT",
  mkt_pillar_angle: "Góc nội dung MKT",
  mkt_media_asset: "Tư liệu MKT",
  mkt_document: "Tài liệu MKT",
  mkt_telegram_account: "Tài khoản Telegram MKT",
  mkt_team_member: "Thành viên MKT",
};

const AUDIT_WORD_LABELS: Record<string, string> = {
  mkt: "MKT",
  task: "công việc",
  tasks: "công việc",
  work: "công việc",
  package: "gói",
  campaign: "chiến dịch",
  channel: "kênh",
  plan: "kế hoạch",
  content: "nội dung",
  pillar: "trụ cột",
  angle: "góc",
  media: "tư liệu",
  document: "tài liệu",
  readiness: "sẵn sàng",
  telegram: "Telegram",
  team: "nhóm",
  member: "thành viên",
  created: "đã tạo",
  create: "tạo",
  updated: "đã cập nhật",
  update: "cập nhật",
  saved: "đã lưu",
  registered: "đã ghi nhận",
  removed: "đã gỡ",
  deleted: "đã xóa",
  deactivated: "đã ngừng hoạt động",
  accepted: "đã chấp nhận",
  rejected: "đã từ chối",
  started: "đã bắt đầu",
  done: "đã hoàn thành",
  completed: "đã hoàn thành",
  canceled: "đã hủy",
  cancelled: "đã hủy",
  reassigned: "đã phân công lại",
  assigned: "đã phân công",
  submitted: "đã gửi",
  reviewed: "đã duyệt",
  review: "duyệt",
  approved: "đã duyệt",
  need: "cần",
  discussion: "trao đổi",
  force: "bắt buộc",
  override: "ngoại lệ",
  status: "trạng thái",
  changed: "đã thay đổi",
  change: "thay đổi",
  requested: "đã yêu cầu",
  generated: "đã tạo",
  from: "từ",
  split: "đã chia",
  manual: "thủ công",
  linked: "đã liên kết",
  unlinked: "đã hủy liên kết",
  pinged: "đã nhắc việc",
  confirmed: "đã xác nhận",
  waived: "đã miễn yêu cầu",
  reminded: "đã nhắc",
  upserted: "đã lưu",
};

const AUDIT_FIELD_LABELS: Record<string, string> = {
  id: "Mã nội bộ",
  code: "Mã",
  name: "Tên",
  title: "Tiêu đề",
  full_name: "Tên đầy đủ",
  email: "Email",
  phone: "Điện thoại",
  description: "Mô tả",
  status: "Trạng thái",
  previous_status: "Trạng thái trước",
  new_status: "Trạng thái mới",
  action: "Hành động",
  reason: "Lý do",
  note: "Ghi chú",
  comment: "Ý kiến",
  message: "Nội dung",
  amount: "Số tiền",
  old_value: "Giá trị cũ",
  new_value: "Giá trị mới",
  total: "Tổng tiền",
  total_amount: "Tổng tiền",
  invoice_total: "Tổng hóa đơn",
  subtotal: "Tiền hàng",
  tax_amount: "Tiền thuế",
  discount_amount: "Tiền giảm giá",
  discount_percent: "Tỷ lệ giảm giá",
  discount_reason: "Lý do giảm giá",
  promotion_discount: "Giảm giá khuyến mãi",
  delivery_fee: "Phí giao hàng",
  shipping_cost: "Chi phí giao hàng",
  payment_method: "Phương thức thanh toán",
  cash_amount_recorded: "Tiền mặt ghi nhận",
  paid: "Đã thanh toán",
  new_paid: "Đã thanh toán mới",
  debt: "Công nợ",
  current_debt: "Công nợ hiện tại",
  new_debt: "Công nợ mới",
  quantity: "Số lượng",
  qty: "Số lượng",
  item_count: "Số dòng",
  items_count: "Số dòng",
  task_count: "Số công việc",
  user_id: "Người dùng",
  actor_id: "Người thực hiện",
  customer_id: "Khách hàng",
  supplier_id: "Nhà cung cấp",
  product_id: "Sản phẩm",
  branch_id: "Chi nhánh",
  tenant_id: "Doanh nghiệp",
  invoice_id: "Hóa đơn",
  invoice_code: "Mã hóa đơn",
  order_id: "Đơn hàng",
  order_code: "Mã đơn hàng",
  purchase_order_id: "Đơn nhập hàng",
  purchase_order_code: "Mã đơn nhập hàng",
  shipment_id: "Vận đơn",
  shipment_code: "Mã vận đơn",
  reference_id: "Chứng từ tham chiếu",
  reference_type: "Loại chứng từ tham chiếu",
  source_id: "Nguồn tham chiếu",
  source_type: "Loại nguồn",
  source: "Nguồn",
  campaign_id: "Chiến dịch",
  version_id: "Phiên bản",
  review_id: "Lượt duyệt",
  assignee_id: "Người phụ trách",
  new_assignee_id: "Người phụ trách mới",
  created_at: "Thời gian tạo",
  updated_at: "Thời gian cập nhật",
  deleted_at: "Thời gian xóa",
  completed_at: "Thời gian hoàn thành",
  is_active: "Đang hoạt động",
  is_exception: "Là ngoại lệ",
  severity: "Mức độ",
  result: "Kết quả",
  mode: "Chế độ",
  auto_saved: "Tự động lưu",
  atomic: "Thao tác đồng bộ",
  type: "Loại",
  kind: "Phân loại",
  warnings: "Cảnh báo",
  items: "Chi tiết",
  permissions: "Quyền",
  branch_ids: "Danh sách chi nhánh",
  target_user_id: "Người dùng đích",
  target_user_name: "Tên người dùng đích",
};

const AUDIT_VALUE_LABELS: Record<string, string> = {
  true: "Có",
  false: "Không",
  draft: "Nháp",
  pending: "Chờ xử lý",
  confirmed: "Đã xác nhận",
  processing: "Đang xử lý",
  doing: "Đang thực hiện",
  review: "Chờ duyệt",
  approved: "Đã duyệt",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  canceled: "Đã hủy",
  rejected: "Bị từ chối",
  active: "Đang hoạt động",
  inactive: "Ngừng hoạt động",
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  mixed: "Hỗn hợp",
  internal: "Nội bộ",
  external: "Bên ngoài",
  success: "Thành công",
  failed: "Thất bại",
  error: "Lỗi",
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
};

function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function translateAuditCode(value: string): string {
  const words = value
    .split(/[_:-]+/)
    .filter(Boolean)
    .map((word) => AUDIT_WORD_LABELS[word.toLowerCase()] ?? word);
  return sentenceCase(words.join(" "));
}

export function getAuditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? translateAuditCode(action);
}

export function getAuditEntityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? translateAuditCode(entityType);
}

export function getAuditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? translateAuditCode(field);
}

/** Dịch bản sao chỉ để hiển thị; không thay đổi dữ liệu audit gốc. */
export function localizeAuditData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localizeAuditData);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        getAuditFieldLabel(key),
        localizeAuditData(item),
      ]),
    );
  }
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "string") return AUDIT_VALUE_LABELS[value] ?? value;
  return value;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function compactInternalId(id: string): string {
  if (!id) return "—";
  return id.includes("-") ? `#${id.slice(-6).toUpperCase()}` : id;
}

function getEntityName(
  entityId: string,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): string {
  const source = { ...(oldData ?? {}), ...(newData ?? {}) };
  const keys = [
    "display_name",
    "full_name",
    "customer_name",
    "supplier_name",
    "product_name",
    "invoice_code",
    "order_code",
    "code",
    "name",
    "email",
    "phone",
  ];

  for (const key of keys) {
    const value = source[key];
    if (
      typeof value === "string" &&
      value.trim() &&
      !UUID_RE.test(value.trim())
    ) {
      return value.trim();
    }
  }

  return compactInternalId(entityId);
}

export function getActionOptions() {
  return Object.entries(ACTION_LABELS).map(([value, label]) => ({
    value,
    label,
  }));
}

export function getEntityTypeOptions() {
  return Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({
    value,
    label,
  }));
}

/* ------------------------------------------------------------------ */
/*  Query                                                              */
/* ------------------------------------------------------------------ */

export async function getAuditLogs(
  params: QueryParams & { filters?: AuditFilters },
): Promise<QueryResult<AuditLogEntry>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // Defense-in-depth: explicit tenant filter ngay cả khi RLS bật. Trước đây
  // service rely 100% vào RLS audit_select policy → khi RLS disable trong
  // dev hoặc thứ tự migration sai → leak audit log cross-tenant (nhạy cảm:
  // ai đã làm gì).
  let query = supabase
    .from("audit_log")
    .select(
      "id, user_id, action, entity_type, entity_id, old_data, new_data, ip_address, created_at, profiles!audit_log_user_id_fkey(full_name)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

  // Filters
  const filters = params.filters as AuditFilters | undefined;

  if (filters?.action && filters.action !== "all") {
    query = query.eq("action", filters.action);
  }
  if (filters?.entityType && filters.entityType !== "all") {
    query = query.eq("entity_type", filters.entityType);
  }
  query = applyCreatedAtRangeFilter(query, filters);
  // Search — by entity_id or user name
  if (params.search) {
    query = query.or(
      `entity_id.ilike.%${params.search}%,action.ilike.%${params.search}%`,
    );
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) {
    // audit_log might not have FK — graceful fallback
    console.warn("getAuditLogs error:", error.message);
    return { data: [], total: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: AuditLogEntry[] = (data ?? []).map((row: any) => {
    const profile = row.profiles as { full_name: string } | null;
    const action = row.action as string;
    const entityType = row.entity_type as string;

    return {
      id: row.id,
      userId: row.user_id ?? "",
      userName: profile?.full_name ?? "Hệ thống",
      action,
      actionLabel: getAuditActionLabel(action),
      entityType,
      entityTypeLabel: getAuditEntityTypeLabel(entityType),
      entityId: row.entity_id ?? "",
      entityName: getEntityName(
        row.entity_id ?? "",
        row.old_data ?? null,
        row.new_data ?? null,
      ),
      oldData: row.old_data ?? null,
      newData: row.new_data ?? null,
      ipAddress: row.ip_address ?? null,
      createdAt: row.created_at,
    };
  });

  return { data: entries, total: count ?? 0 };
}

/* ------------------------------------------------------------------ */
/*  Write helper — manual audit log insert (no triggers)               */
/* ------------------------------------------------------------------ */

/**
 * Ghi 1 entry vào `audit_log` cho thao tác create/update/delete.
 *
 * Dùng cho service tự ghi audit khi schema không có DB trigger
 * (KH, NCC, ...). Best-effort: nếu insert fail (RLS, FK profile),
 * chỉ console.warn — KHÔNG throw để tránh làm hỏng luồng chính.
 *
 * @param entityType — string từ ENTITY_TYPE_LABELS (vd: "customer", "supplier")
 * @param entityId — UUID record vừa thao tác
 * @param action — "create" | "update" | "delete" | ... (xem ACTION_LABELS)
 * @param oldData — null cho create, snapshot trước cho update/delete
 * @param newData — null cho delete, snapshot sau cho create/update
 */
export async function recordAuditLog(params: {
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete" | string;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = getClient();
  try {
    const ctx = await getCurrentContext();
    await supabase.from("audit_log").insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      // Cast object → Json (Supabase typing accepts JSON shape but TS doesn't
      // unify Record<string,unknown> with Json union automatically).
      old_data: (params.oldData ?? null) as never,
      new_data: (params.newData ?? null) as never,
    });
  } catch (err) {
    console.warn(
      `[recordAuditLog] ${params.entityType}/${params.action} failed:`,
      err,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Lookup by entity — dùng cho InlineDetailPanel "Lịch sử" tab        */
/* ------------------------------------------------------------------ */

/**
 * Lấy audit log của một entity cụ thể (theo entity_type + entity_id).
 * Dùng cho tab "Lịch sử" trong InlineDetailPanel. Giới hạn 50 bản ghi
 * gần nhất theo `created_at DESC`.
 */
export async function getAuditLogsByEntity(
  entityType: string,
  entityId: string,
  limit: number = 50,
): Promise<AuditLogEntry[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, user_id, action, entity_type, entity_id, old_data, new_data, ip_address, created_at, profiles!audit_log_user_id_fkey(full_name)",
    )
    .eq("tenant_id", tenantId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("getAuditLogsByEntity error:", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const profile = row.profiles as { full_name: string } | null;
    const action = row.action as string;
    const et = row.entity_type as string;
    return {
      id: row.id,
      userId: row.user_id ?? "",
      userName: profile?.full_name ?? "Hệ thống",
      action,
      actionLabel: getAuditActionLabel(action),
      entityType: et,
      entityTypeLabel: getAuditEntityTypeLabel(et),
      entityId: row.entity_id ?? "",
      entityName: getEntityName(
        row.entity_id ?? "",
        row.old_data ?? null,
        row.new_data ?? null,
      ),
      oldData: row.old_data ?? null,
      newData: row.new_data ?? null,
      ipAddress: row.ip_address ?? null,
      createdAt: row.created_at,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Profile suggestions cho PersonFilter (dùng chung cho mọi page)     */
/* ------------------------------------------------------------------ */

/**
 * Lấy danh sách profiles (user trong tenant hiện tại) làm suggestions
 * cho `PersonFilter`. Trả về `{ label, value }` dạng map sẵn.
 *
 * Trước đây các page như khach-hang hardcode ["admin", "trang"] → giả-suggestion.
 * Service này load thực tế từ DB; fail-soft trả [] nếu lỗi.
 */
export async function getProfilesForPersonFilter(): Promise<
  { label: string; value: string }[]
> {
  const supabase = getClient();
  try {
    const tenantId = await getCurrentTenantId();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true });
    if (error) {
      console.warn("[getProfilesForPersonFilter]", error.message);
      return [];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((p: any) => ({
      label: p.full_name || p.email || "(không tên)",
      value: p.id,
    }));
  } catch (err) {
    console.warn("[getProfilesForPersonFilter]", err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Stats (summary for audit page header)                              */
/* ------------------------------------------------------------------ */

export async function getAuditStats(): Promise<{
  totalToday: number;
  totalWeek: number;
  topAction: string;
  topEntity: string;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 7,
  ).toISOString();

  // Defense-in-depth tenant filter cho cả 2 query stats.
  const [todayRes, weekRes] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", todayStart),
    supabase
      .from("audit_log")
      .select("action, entity_type")
      .eq("tenant_id", tenantId)
      .gte("created_at", weekStart),
  ]);

  const totalToday = todayRes.count ?? 0;
  const weekData = weekRes.data ?? [];
  const totalWeek = weekData.length;

  // Find most common action and entity
  const actionCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();
  for (const row of weekData) {
    const a = row.action as string;
    const e = row.entity_type as string;
    actionCounts.set(a, (actionCounts.get(a) ?? 0) + 1);
    entityCounts.set(e, (entityCounts.get(e) ?? 0) + 1);
  }

  let topAction = "—";
  let topActionCount = 0;
  for (const [k, v] of actionCounts) {
    if (v > topActionCount) {
      topActionCount = v;
      topAction = getAuditActionLabel(k);
    }
  }

  let topEntity = "—";
  let topEntityCount = 0;
  for (const [k, v] of entityCounts) {
    if (v > topEntityCount) {
      topEntityCount = v;
      topEntity = getAuditEntityTypeLabel(k);
    }
  }

  return { totalToday, totalWeek, topAction, topEntity };
}
