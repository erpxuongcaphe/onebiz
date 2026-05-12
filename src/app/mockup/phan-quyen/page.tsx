"use client";

/**
 * MOCKUP — RBAC Phân quyền (UX redesign tham khảo KiotViet/Sapo/Misa)
 * Route: /mockup/phan-quyen
 *
 * Mục tiêu: thiết kế UI/UX để CEO không nhầm phân quyền:
 *  - Permission nhạy cảm (xoá/hủy/duyệt giảm giá) HIỂN THỊ RÕ RÀNG
 *  - Constraint editor inline (max %, time window, "chỉ của mình")
 *  - Module master toggle (tắt cả module 1 lần)
 *  - OTP duyệt từ xa cho 6 action nhạy cảm (CEO 12/05)
 *  - Diff compare 2 vai trò
 *  - Audit log thay đổi quyền
 *
 * Sau khi CEO duyệt design → em apply vào /cai-dat/phan-quyen thật.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Mock data ──

type TabId = "roles" | "users" | "audit" | "otp";

interface MockRole {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  isSystem: boolean;
  memberCount: number;
  permissionCount: number;
  totalCount: number;
}

interface MockUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  roleId: string;
  branches: string[];
  isActive: boolean;
  hasPin: boolean;
  lastLogin: string;
}

interface MockPermission {
  code: string;
  label: string;
  description: string;
  /** "danger" = không hoàn tác, "warning" = nhạy cảm cần thông báo, "normal" = thường */
  level: "danger" | "warning" | "normal";
  /** Constraint editor type */
  constraint?: ConstraintType;
}

type ConstraintType = "max_percent" | "max_amount" | "time_window" | "scope" | "require_pin";

interface MockGroup {
  group: string;
  module: string;
  icon: string;
  permissions: MockPermission[];
}

const MOCK_ROLES: MockRole[] = [
  { id: "owner", name: "Chủ cửa hàng", description: "Toàn quyền hệ thống", color: "bg-red-500", icon: "shield_person", isSystem: true, memberCount: 1, permissionCount: 50, totalCount: 50 },
  { id: "admin", name: "Quản trị", description: "Quản trị hệ thống (trừ phân quyền)", color: "bg-purple-500", icon: "admin_panel_settings", isSystem: true, memberCount: 2, permissionCount: 48, totalCount: 50 },
  { id: "manager", name: "Quản lý ca", description: "Quản lý hoạt động quán + duyệt thao tác nhạy cảm", color: "bg-blue-500", icon: "manage_accounts", isSystem: true, memberCount: 3, permissionCount: 35, totalCount: 50 },
  { id: "cashier", name: "Thu ngân F&B", description: "Bán hàng, thu tiền, không hủy bill", color: "bg-green-500", icon: "point_of_sale", isSystem: true, memberCount: 5, permissionCount: 12, totalCount: 50 },
  { id: "server", name: "Phục vụ", description: "Nhận order, quản lý bàn, gửi bếp", color: "bg-teal-500", icon: "restaurant_menu", isSystem: true, memberCount: 4, permissionCount: 8, totalCount: 50 },
  { id: "warehouse", name: "Kho vận", description: "Nhập xuất kho, kiểm kho", color: "bg-orange-500", icon: "warehouse", isSystem: true, memberCount: 2, permissionCount: 10, totalCount: 50 },
  { id: "accountant", name: "Kế toán", description: "Báo cáo tài chính, công nợ", color: "bg-indigo-500", icon: "account_balance", isSystem: true, memberCount: 1, permissionCount: 15, totalCount: 50 },
  { id: "custom-1", name: "Trưởng ca bar", description: "Tuỳ chỉnh — kiêm pha chế + duyệt giảm", color: "bg-pink-500", icon: "local_bar", isSystem: false, memberCount: 2, permissionCount: 18, totalCount: 50 },
];

const MODULES = [
  { code: "pos_fnb", label: "POS F&B", icon: "restaurant" },
  { code: "pos_retail", label: "POS Bán lẻ", icon: "store" },
  { code: "inventory", label: "Kho hàng", icon: "inventory_2" },
  { code: "finance", label: "Tài chính", icon: "account_balance_wallet" },
  { code: "products", label: "Sản phẩm", icon: "category" },
  { code: "customers", label: "Khách hàng", icon: "groups" },
  { code: "reports", label: "Báo cáo", icon: "analytics" },
  { code: "system", label: "Hệ thống", icon: "settings" },
];

const PERMISSION_GROUPS: MockGroup[] = [
  {
    group: "POS F&B", module: "pos_fnb", icon: "restaurant",
    permissions: [
      { code: "pos_fnb.send_kitchen", label: "Gửi bếp", description: "Gửi order vào bếp/bar", level: "normal" },
      { code: "pos_fnb.view_orders", label: "Xem đơn bếp", description: "Xem danh sách order đã gửi", level: "normal" },
      { code: "pos_fnb.manage_tables", label: "Quản lý bàn", description: "Mở/đóng/chuyển bàn", level: "normal" },
      { code: "pos_fnb.split_bill", label: "Tách bill", description: "Tách 1 bill thành nhiều bill", level: "normal" },
      { code: "pos_fnb.transfer_table", label: "Chuyển bàn", description: "Chuyển order sang bàn khác", level: "normal" },
      { code: "pos_fnb.discount", label: "Áp giảm giá", description: "Giảm giá cho bill — có thể giới hạn % tối đa", level: "warning", constraint: "max_percent" },
      { code: "pos_fnb.cancel_unpaid_order", label: "Hủy đơn chưa thanh toán", description: "Hủy bill chưa thu tiền — có thể yêu cầu PIN quản lý", level: "warning", constraint: "require_pin" },
      { code: "pos_fnb.edit_sent_order", label: "Sửa món đã gửi bếp", description: "Thêm/bớt món sau khi đã gửi bếp — có thể giới hạn thời gian", level: "warning", constraint: "time_window" },
      { code: "pos_fnb.void_paid_bill", label: "Hủy bill đã thanh toán", description: "Hủy + hoàn tiền bill đã thanh toán — bắt buộc PIN quản lý", level: "danger", constraint: "require_pin" },
    ],
  },
  {
    group: "Kho hàng", module: "inventory", icon: "inventory_2",
    permissions: [
      { code: "inventory.view", label: "Xem tồn kho", description: "Xem số lượng tồn", level: "normal" },
      { code: "inventory.create_po", label: "Tạo phiếu nhập", description: "Lập đơn đặt hàng / phiếu nhập kho", level: "normal" },
      { code: "inventory.transfer", label: "Chuyển kho", description: "Chuyển hàng giữa chi nhánh", level: "warning", constraint: "max_amount" },
      { code: "inventory.adjust", label: "Điều chỉnh kho", description: "Sửa số lượng tồn thủ công", level: "warning", constraint: "require_pin" },
      { code: "inventory.check", label: "Kiểm kho", description: "Đếm thực tế + chênh lệch", level: "normal" },
      { code: "inventory.dispose", label: "Xuất hủy hàng", description: "Hủy hàng hỏng/hết hạn — không hoàn tác", level: "danger", constraint: "require_pin" },
      { code: "inventory.internal_export", label: "Xuất nội bộ", description: "Xuất hàng dùng nội bộ (không bán)", level: "warning", constraint: "max_amount" },
    ],
  },
  {
    group: "Sản phẩm", module: "products", icon: "category",
    permissions: [
      { code: "products.view", label: "Xem sản phẩm", description: "Xem danh sách + thông tin SP", level: "normal" },
      { code: "products.view_cost", label: "Xem giá vốn", description: "Xem giá nhập / chi phí — chỉ chủ + kế toán", level: "warning" },
      { code: "products.view_profit", label: "Xem lợi nhuận", description: "Xem % lãi gộp trên SP", level: "warning" },
      { code: "products.create", label: "Thêm sản phẩm", description: "Tạo SP mới", level: "normal" },
      { code: "products.edit", label: "Sửa sản phẩm", description: "Sửa giá / mô tả / hình ảnh", level: "warning" },
      { code: "products.manage_prices", label: "Quản lý giá bán", description: "Sửa bảng giá nhiều kênh", level: "warning" },
      { code: "products.import", label: "Nhập Excel", description: "Import hàng loạt từ file Excel", level: "warning" },
      { code: "products.export", label: "Xuất Excel", description: "Export danh sách SP", level: "normal" },
      { code: "products.delete", label: "Xoá sản phẩm", description: "Xoá vĩnh viễn SP — không hoàn tác", level: "danger" },
    ],
  },
  {
    group: "Tài chính", module: "finance", icon: "account_balance_wallet",
    permissions: [
      { code: "finance.view_cash_book", label: "Xem sổ quỹ", description: "Xem phiếu thu/chi", level: "normal" },
      { code: "finance.create_transaction", label: "Tạo phiếu thu/chi", description: "Lập giao dịch tiền", level: "warning", constraint: "max_amount" },
      { code: "finance.view_reports", label: "Xem báo cáo", description: "Doanh thu, lãi gộp, công nợ", level: "warning" },
      { code: "finance.void_transaction", label: "Hủy giao dịch", description: "Hủy phiếu thu/chi đã tạo — bắt buộc PIN", level: "danger", constraint: "require_pin" },
    ],
  },
  {
    group: "Khách hàng", module: "customers", icon: "groups",
    permissions: [
      { code: "customers.view", label: "Xem khách hàng", description: "Xem danh sách KH", level: "normal" },
      { code: "customers.create", label: "Thêm KH", description: "Tạo KH mới", level: "normal" },
      { code: "customers.edit", label: "Sửa KH", description: "Sửa thông tin KH", level: "normal" },
      { code: "customers.view_debt", label: "Xem công nợ", description: "Xem nợ phải thu của KH", level: "warning" },
      { code: "customers.delete", label: "Xoá khách hàng", description: "Xoá KH vĩnh viễn", level: "danger" },
    ],
  },
  {
    group: "Hệ thống", module: "system", icon: "settings",
    permissions: [
      { code: "system.manage_users", label: "Quản lý nhân viên", description: "Mời, sửa, khoá nhân viên", level: "warning" },
      { code: "system.manage_branches", label: "Quản lý chi nhánh", description: "Tạo, sửa chi nhánh", level: "warning" },
      { code: "system.manage_roles", label: "Quản lý vai trò", description: "Tạo, sửa, xoá vai trò + phân quyền", level: "danger" },
      { code: "system.view_audit", label: "Xem lịch sử thao tác", description: "Audit log toàn hệ thống", level: "normal" },
      { code: "system.set_pin", label: "Đặt PIN POS cho nhân viên", description: "Tạo/đổi PIN switch user trên POS", level: "warning" },
    ],
  },
];

const MOCK_USERS: MockUser[] = [
  { id: "u1", fullName: "Đinh Quốc Toàn", email: "toanqqdinh@gmail.com", phone: "0912345678", roleId: "owner", branches: ["Tất cả"], isActive: true, hasPin: true, lastLogin: "2 phút trước" },
  { id: "u2", fullName: "Nguyễn Văn An", email: "an.nguyen@onebiz.vn", phone: "0987654321", roleId: "manager", branches: ["FNB01 Lý Tự Trọng", "FNB02 Pasteur"], isActive: true, hasPin: true, lastLogin: "15 phút trước" },
  { id: "u3", fullName: "Trần Thị Bích", email: "bich.tran@onebiz.vn", phone: "0901234567", roleId: "cashier", branches: ["FNB01 Lý Tự Trọng"], isActive: true, hasPin: true, lastLogin: "Đang hoạt động" },
  { id: "u4", fullName: "Lê Văn Cường", email: "cuong.le@onebiz.vn", phone: "0934567890", roleId: "server", branches: ["FNB01 Lý Tự Trọng"], isActive: true, hasPin: false, lastLogin: "Đang hoạt động" },
  { id: "u5", fullName: "Phạm Thị Dung", email: "dung.pham@onebiz.vn", phone: "0945678901", roleId: "warehouse", branches: ["KHO01 Kho Tổng"], isActive: true, hasPin: true, lastLogin: "Hôm qua, 18:30" },
  { id: "u6", fullName: "Hoàng Minh Em", email: "em.hoang@onebiz.vn", phone: "0956789012", roleId: "accountant", branches: ["Tất cả"], isActive: false, hasPin: false, lastLogin: "1 tuần trước" },
];

const MOCK_AUDIT = [
  { time: "12/05 14:22", actor: "Đinh Quốc Toàn", action: "Cấp vai trò", target: "Trưởng ca bar → Trần Thị Bích", icon: "person_add", color: "text-status-success" },
  { time: "12/05 11:08", actor: "Đinh Quốc Toàn", action: "Sửa quyền vai trò", target: "Phục vụ: bật Áp giảm giá (tối đa 5%)", icon: "edit", color: "text-status-warning" },
  { time: "12/05 10:55", actor: "Nguyễn Văn An", action: "Cấp OTP duyệt", target: "Xoá bill B-2042 — duyệt cho Trần Thị Bích", icon: "pin", color: "text-primary" },
  { time: "11/05 16:30", actor: "Đinh Quốc Toàn", action: "Tạo vai trò", target: "Trưởng ca bar (18 quyền)", icon: "shield_lock", color: "text-status-success" },
  { time: "11/05 09:15", actor: "Đinh Quốc Toàn", action: "Khoá nhân viên", target: "Hoàng Minh Em (lý do: nghỉ việc)", icon: "block", color: "text-status-error" },
  { time: "10/05 14:00", actor: "Đinh Quốc Toàn", action: "Tắt quyền", target: "Thu ngân F&B: bỏ Áp giảm giá", icon: "remove_circle", color: "text-status-error" },
];

// ── Helpers ──

function levelStyle(level: MockPermission["level"]) {
  switch (level) {
    case "danger":
      return { dot: "bg-status-error", label: "Không hoàn tác", labelClass: "text-status-error", iconColor: "text-status-error" };
    case "warning":
      return { dot: "bg-status-warning", label: "Nhạy cảm", labelClass: "text-status-warning", iconColor: "text-status-warning" };
    default:
      return { dot: "bg-muted-foreground", label: "", labelClass: "", iconColor: "text-muted-foreground" };
  }
}

// ── Main ──

export default function PhanQuyenMockup() {
  const [activeTab, setActiveTab] = useState<TabId>("roles");
  const [activeRoleId, setActiveRoleId] = useState<string>("cashier");
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [compareWithId, setCompareWithId] = useState<string | null>(null);

  const activeRole = MOCK_ROLES.find((r) => r.id === activeRoleId)!;

  return (
    <div className="min-h-screen bg-surface-container-low">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span>Mockup</span>
              <Icon name="chevron_right" size={14} />
              <span>Phân quyền</span>
              <Badge variant="outline" className="text-[10px]">Đề xuất UX</Badge>
            </div>
            <h1 className="text-xl font-bold text-foreground">Phân quyền & Nhân viên</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tham khảo KiotViet / Sapo / Misa — anh duyệt design xong em apply vào trang thật
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Icon name="visibility" size={14} className="mr-1" />
              Xem trang hiện tại
            </Button>
            <Button size="sm">
              <Icon name="check" size={14} className="mr-1" />
              Duyệt design này
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-4 -mb-1">
          {[
            { id: "roles" as TabId, label: "Vai trò", icon: "shield", count: MOCK_ROLES.length },
            { id: "users" as TabId, label: "Nhân viên", icon: "groups", count: MOCK_USERS.length },
            { id: "otp" as TabId, label: "OTP duyệt từ xa", icon: "pin", count: 6 },
            { id: "audit" as TabId, label: "Lịch sử thay đổi quyền", icon: "history", count: MOCK_AUDIT.length },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
              <Badge variant="secondary" className="text-[10px]">
                {t.count}
              </Badge>
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      <div className="flex-1">
        {activeTab === "roles" && (
          <RolesTab
            activeRoleId={activeRoleId}
            setActiveRoleId={setActiveRoleId}
            compareWithId={compareWithId}
            setCompareWithId={setCompareWithId}
            activeRole={activeRole}
          />
        )}
        {activeTab === "users" && <UsersTab activeUserId={activeUserId} setActiveUserId={setActiveUserId} />}
        {activeTab === "otp" && <OtpTab />}
        {activeTab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}

// ── TAB: VAI TRÒ ──

interface RolesTabProps {
  activeRoleId: string;
  setActiveRoleId: (id: string) => void;
  compareWithId: string | null;
  setCompareWithId: (id: string | null) => void;
  activeRole: MockRole;
}

function RolesTab({ activeRoleId, setActiveRoleId, compareWithId, setCompareWithId, activeRole }: RolesTabProps) {
  // Mock: cashier role có 12 permissions hardcoded
  const ENABLED: Record<string, Set<string>> = {
    owner: new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.code))),
    admin: new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.code)).filter((c) => c !== "system.manage_roles")),
    manager: new Set([
      "pos_fnb.send_kitchen", "pos_fnb.view_orders", "pos_fnb.manage_tables", "pos_fnb.split_bill", "pos_fnb.transfer_table",
      "pos_fnb.discount", "pos_fnb.cancel_unpaid_order", "pos_fnb.edit_sent_order", "pos_fnb.void_paid_bill",
      "inventory.view", "inventory.create_po", "inventory.transfer", "inventory.adjust", "inventory.check", "inventory.internal_export",
      "products.view", "products.view_cost", "products.create", "products.edit", "products.manage_prices",
      "finance.view_cash_book", "finance.create_transaction", "finance.view_reports", "finance.void_transaction",
      "customers.view", "customers.create", "customers.edit", "customers.view_debt",
      "system.view_audit", "system.set_pin",
    ]),
    cashier: new Set([
      "pos_fnb.send_kitchen", "pos_fnb.view_orders", "pos_fnb.split_bill", "pos_fnb.transfer_table",
      "finance.view_cash_book", "finance.create_transaction",
      "products.view", "customers.view", "customers.create",
    ]),
    server: new Set([
      "pos_fnb.send_kitchen", "pos_fnb.view_orders", "pos_fnb.manage_tables", "pos_fnb.transfer_table",
      "products.view", "customers.view",
    ]),
    warehouse: new Set([
      "inventory.view", "inventory.create_po", "inventory.transfer", "inventory.adjust", "inventory.check", "inventory.dispose", "inventory.internal_export",
      "products.view", "products.import", "products.export",
    ]),
    accountant: new Set([
      "finance.view_cash_book", "finance.create_transaction", "finance.view_reports", "finance.void_transaction",
      "products.view", "products.view_cost", "products.view_profit", "customers.view", "customers.view_debt",
    ]),
    "custom-1": new Set([
      "pos_fnb.send_kitchen", "pos_fnb.view_orders", "pos_fnb.manage_tables", "pos_fnb.split_bill", "pos_fnb.transfer_table",
      "pos_fnb.discount", "pos_fnb.cancel_unpaid_order",
      "inventory.view", "products.view", "customers.view", "customers.create", "finance.view_cash_book",
    ]),
  };

  const enabled = ENABLED[activeRoleId] ?? new Set<string>();
  const compareEnabled = compareWithId ? ENABLED[compareWithId] ?? new Set<string>() : null;

  return (
    <div className="flex">
      {/* Sidebar: role list */}
      <aside className="w-72 border-r border-border bg-surface min-h-[calc(100vh-145px)] p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vai trò</h3>
          <Button variant="ghost" size="sm" className="h-7 px-2">
            <Icon name="add" size={14} className="mr-0.5" />
            Thêm
          </Button>
        </div>
        <div className="space-y-1">
          {MOCK_ROLES.map((r) => {
            const isActive = r.id === activeRoleId;
            return (
              <button
                key={r.id}
                onClick={() => setActiveRoleId(r.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-lg transition-colors",
                  isActive
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "hover:bg-surface-container"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center text-white shrink-0", r.color)}>
                    <Icon name={r.icon} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{r.name}</span>
                      {r.isSystem && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">HT</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-0.5">
                        <Icon name="group" size={11} />
                        {r.memberCount}
                      </span>
                      <span>·</span>
                      <span>
                        {r.permissionCount}/{r.totalCount} quyền
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main: editor */}
      <main className="flex-1 p-6 max-w-5xl">
        {/* Role header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-3">
            <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center text-white shrink-0", activeRole.color)}>
              <Icon name={activeRole.icon} size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">{activeRole.name}</h2>
                {activeRole.isSystem && (
                  <Badge variant="outline" className="text-[10px]">Vai trò hệ thống</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{activeRole.description}</p>
              <div className="flex items-center gap-3 mt-2 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Icon name="group" size={12} />
                  <span className="font-medium text-foreground">{activeRole.memberCount}</span> nhân viên
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Icon name="check_circle" size={12} />
                  <span className="font-medium text-foreground">{activeRole.permissionCount}</span>/{activeRole.totalCount} quyền
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">So sánh với:</span>
              <select
                className="text-xs border border-border rounded-md px-2 py-1 bg-surface"
                value={compareWithId ?? ""}
                onChange={(e) => setCompareWithId(e.target.value || null)}
              >
                <option value="">— Không —</option>
                {MOCK_ROLES.filter((r) => r.id !== activeRoleId).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <Button variant="outline" size="sm">
              <Icon name="content_copy" size={14} className="mr-1" />
              Sao chép
            </Button>
            <Button size="sm">
              <Icon name="save" size={14} className="mr-1" />
              Lưu thay đổi
            </Button>
          </div>
        </div>

        {/* Module master toggles */}
        <div className="bg-surface border border-border rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Bật/tắt cả module</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tắt module → ẩn toàn bộ menu + chặn truy cập route module đó
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MODULES.map((m) => {
              const moduleOn = activeRoleId !== "server" || m.code !== "system"; // mock
              return (
                <button
                  key={m.code}
                  className={cn(
                    "flex items-center gap-2 p-2.5 rounded-lg border-2 transition-colors text-left",
                    moduleOn
                      ? "border-status-success/30 bg-status-success/5"
                      : "border-status-error/30 bg-status-error/5 opacity-60"
                  )}
                >
                  <Icon name={m.icon} size={16} className={moduleOn ? "text-status-success" : "text-status-error"} />
                  <div className="flex-1">
                    <div className="text-xs font-medium">{m.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {moduleOn ? "Đang bật" : "Đã tắt"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4 px-1">
          <span className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-status-error" />
            Không hoàn tác
          </span>
          <span className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-status-warning" />
            Nhạy cảm (có thể cần PIN duyệt)
          </span>
          <span className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-muted-foreground" />
            Thường
          </span>
          {compareWithId && (
            <>
              <span className="mx-2">|</span>
              <span className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-sm bg-status-success/20 border border-status-success" />
                Khác với {MOCK_ROLES.find((r) => r.id === compareWithId)?.name}
              </span>
            </>
          )}
        </div>

        {/* Permission groups */}
        <div className="space-y-4">
          {PERMISSION_GROUPS.map((group) => {
            const onCount = group.permissions.filter((p) => enabled.has(p.code)).length;
            return (
              <div key={group.group} className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-surface-container-low border-b border-border">
                  <div className="flex items-center gap-2">
                    <Icon name={group.icon} size={18} className="text-muted-foreground" />
                    <h4 className="text-sm font-semibold">{group.group}</h4>
                    <Badge variant="secondary" className="text-[10px]">
                      {onCount}/{group.permissions.length}
                    </Badge>
                  </div>
                  <button className="text-[11px] text-primary hover:underline">
                    {onCount === group.permissions.length ? "Bỏ tất cả" : "Bật tất cả"}
                  </button>
                </div>
                <div className="divide-y divide-border">
                  {group.permissions.map((p) => {
                    const isOn = enabled.has(p.code);
                    const compareOn = compareEnabled?.has(p.code) ?? null;
                    const diff = compareOn !== null && compareOn !== isOn;
                    const lv = levelStyle(p.level);

                    return (
                      <PermissionRow
                        key={p.code}
                        permission={p}
                        isOn={isOn}
                        diff={diff}
                        compareOn={compareOn}
                        levelStyle={lv}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex items-center justify-between pt-4 border-t border-border">
          {!activeRole.isSystem ? (
            <Button variant="ghost" size="sm" className="text-status-error hover:bg-status-error/10">
              <Icon name="delete" size={16} className="mr-1" />
              Xoá vai trò
            </Button>
          ) : <div />}
          <Button size="sm">
            <Icon name="save" size={16} className="mr-1" />
            Lưu thay đổi
          </Button>
        </div>
      </main>
    </div>
  );
}

// ── Permission row component ──

interface PermissionRowProps {
  permission: MockPermission;
  isOn: boolean;
  diff: boolean;
  compareOn: boolean | null;
  levelStyle: { dot: string; label: string; labelClass: string; iconColor: string };
}

function PermissionRow({ permission, isOn, diff, compareOn, levelStyle: lv }: PermissionRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low transition-colors",
        diff && "bg-status-success/5"
      )}
    >
      {/* Diff indicator */}
      {diff && (
        <div className="w-1 h-8 rounded-full bg-status-success absolute left-0" />
      )}

      {/* Toggle */}
      <button
        className={cn(
          "h-5 w-9 rounded-full transition-colors relative shrink-0",
          isOn ? "bg-primary" : "bg-surface-container"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            isOn ? "left-[18px]" : "left-0.5"
          )}
        />
      </button>

      {/* Level dot */}
      <div className={cn("h-2 w-2 rounded-full shrink-0", lv.dot)} />

      {/* Label + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{permission.label}</span>
          {permission.level !== "normal" && (
            <Badge
              variant="outline"
              className={cn("text-[9px] px-1 py-0 h-4", lv.labelClass, "border-current")}
            >
              {lv.label}
            </Badge>
          )}
          {diff && compareOn !== null && (
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 h-4 border-status-success text-status-success"
            >
              {isOn ? "Có" : "Không"} ↔ {compareOn ? "Có" : "Không"}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{permission.description}</p>
      </div>

      {/* Constraint editor inline */}
      {isOn && permission.constraint && <ConstraintEditor type={permission.constraint} />}
    </div>
  );
}

// ── Constraint editor ──

function ConstraintEditor({ type }: { type: ConstraintType }) {
  switch (type) {
    case "max_percent":
      return (
        <div className="flex items-center gap-1.5 shrink-0 bg-status-warning/10 px-2 py-1 rounded-md border border-status-warning/30">
          <Icon name="percent" size={12} className="text-status-warning" />
          <span className="text-[11px] text-muted-foreground">tối đa</span>
          <Input className="h-6 w-12 text-xs px-1 text-center" defaultValue="10" />
          <span className="text-[11px] text-muted-foreground">%</span>
        </div>
      );
    case "max_amount":
      return (
        <div className="flex items-center gap-1.5 shrink-0 bg-status-warning/10 px-2 py-1 rounded-md border border-status-warning/30">
          <Icon name="payments" size={12} className="text-status-warning" />
          <span className="text-[11px] text-muted-foreground">tối đa</span>
          <Input className="h-6 w-20 text-xs px-1 text-center" defaultValue="5,000,000" />
          <span className="text-[11px] text-muted-foreground">đ</span>
        </div>
      );
    case "time_window":
      return (
        <div className="flex items-center gap-1.5 shrink-0 bg-status-warning/10 px-2 py-1 rounded-md border border-status-warning/30">
          <Icon name="schedule" size={12} className="text-status-warning" />
          <span className="text-[11px] text-muted-foreground">trong</span>
          <Input className="h-6 w-12 text-xs px-1 text-center" defaultValue="2" />
          <span className="text-[11px] text-muted-foreground">giờ sau khi gửi</span>
        </div>
      );
    case "scope":
      return (
        <div className="flex items-center gap-1.5 shrink-0 bg-surface-container px-2 py-1 rounded-md">
          <span className="text-[11px] text-muted-foreground">Phạm vi:</span>
          <select className="text-[11px] border-0 bg-transparent">
            <option>Chỉ của mình</option>
            <option>Cả ca</option>
            <option>Cả chi nhánh</option>
          </select>
        </div>
      );
    case "require_pin":
      return (
        <div className="flex items-center gap-1.5 shrink-0 bg-status-error/10 px-2 py-1 rounded-md border border-status-error/30">
          <Icon name="pin" size={12} className="text-status-error" />
          <label className="flex items-center gap-1 text-[11px] text-status-error cursor-pointer">
            <input type="checkbox" defaultChecked className="h-3 w-3 accent-status-error" />
            Yêu cầu PIN quản lý
          </label>
        </div>
      );
    default:
      return null;
  }
}

// ── TAB: NHÂN VIÊN ──

function UsersTab({ activeUserId, setActiveUserId }: { activeUserId: string | null; setActiveUserId: (id: string | null) => void }) {
  const activeUser = MOCK_USERS.find((u) => u.id === activeUserId);

  return (
    <div className="flex">
      <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">Nhân viên</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{MOCK_USERS.length} người · {MOCK_USERS.filter((u) => u.isActive).length} đang hoạt động</p>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Tìm tên, email, SĐT..." className="w-72 h-9" />
            <Button variant="outline" size="sm">
              <Icon name="filter_list" size={14} className="mr-1" />
              Lọc
            </Button>
            <Button size="sm">
              <Icon name="person_add" size={14} className="mr-1" />
              Mời nhân viên
            </Button>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low border-b border-border">
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Nhân viên</th>
                <th className="px-4 py-3 font-medium">Vai trò</th>
                <th className="px-4 py-3 font-medium">Chi nhánh</th>
                <th className="px-4 py-3 font-medium">Quyền duyệt OTP</th>
                <th className="px-4 py-3 font-medium">Hoạt động</th>
                <th className="px-4 py-3 font-medium text-right">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {MOCK_USERS.map((u) => {
                const role = MOCK_ROLES.find((r) => r.id === u.roleId);
                const isActive = activeUserId === u.id;
                return (
                  <tr
                    key={u.id}
                    onClick={() => setActiveUserId(u.id)}
                    className={cn(
                      "cursor-pointer transition-colors",
                      isActive ? "bg-primary/5" : "hover:bg-surface-container-low"
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold">
                          {u.fullName.split(" ").map((n) => n[0]).slice(-2).join("")}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{u.fullName}</div>
                          <div className="text-xs text-muted-foreground">{u.email} · {u.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-6 w-6 rounded-md flex items-center justify-center text-white", role?.color)}>
                          <Icon name={role?.icon ?? "shield"} size={12} />
                        </div>
                        <span className="text-sm">{role?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.branches.map((b) => (
                          <Badge key={b} variant="outline" className="text-[10px]">{b}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {/* Role có thể cấp OTP cho action nào — phụ thuộc permission */}
                      {["owner", "admin", "manager", "custom-1"].includes(u.roleId) ? (
                        <span className="inline-flex items-center gap-1 text-xs text-status-success">
                          <Icon name="vpn_key" size={14} /> Có thể duyệt
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Icon name="lock" size={14} /> Cần xin OTP
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.lastLogin}</td>
                    <td className="px-4 py-3 text-right">
                      {u.isActive ? (
                        <Badge className="bg-status-success/10 text-status-success border-status-success/30">
                          Đang hoạt động
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Đã khoá</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {/* User detail drawer */}
      {activeUser && (
        <aside className="w-96 border-l border-border bg-surface min-h-[calc(100vh-145px)]">
          <div className="sticky top-[145px] p-5 space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-bold">
                  {activeUser.fullName.split(" ").map((n) => n[0]).slice(-2).join("")}
                </div>
                <div>
                  <h3 className="font-semibold">{activeUser.fullName}</h3>
                  <p className="text-xs text-muted-foreground">{activeUser.email}</p>
                  <p className="text-xs text-muted-foreground">{activeUser.phone}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setActiveUserId(null)}>
                <Icon name="close" size={16} />
              </Button>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Vai trò</label>
              <select className="w-full mt-1 px-3 py-2 border border-border rounded-md text-sm bg-surface">
                {MOCK_ROLES.map((r) => (
                  <option key={r.id} value={r.id} selected={r.id === activeUser.roleId}>{r.name} · {r.permissionCount} quyền</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Chi nhánh được phép</label>
              <div className="flex flex-wrap gap-1 mt-1.5">
                <Badge className="bg-primary/10 text-primary border-primary/30">FNB01 Lý Tự Trọng ×</Badge>
                <Badge className="bg-primary/10 text-primary border-primary/30">FNB02 Pasteur ×</Badge>
                <Button variant="outline" size="sm" className="h-6 text-[10px]">
                  <Icon name="add" size={12} className="mr-0.5" /> Thêm
                </Button>
              </div>
            </div>

            <div className="border border-border rounded-lg p-3 bg-surface-container-low">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-1.5">
                    <Icon name="vpn_key" size={14} className="text-status-warning" />
                    Quyền cấp OTP duyệt từ xa
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Cashier xin OTP qua điện thoại để duyệt thao tác nhạy cảm
                  </p>
                </div>
                {["owner", "admin", "manager", "custom-1"].includes(activeUser.roleId) ? (
                  <Badge className="bg-status-success/10 text-status-success border-status-success/30">Có thể duyệt</Badge>
                ) : (
                  <Badge variant="outline">Không duyệt</Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Quản lý vào <span className="font-medium text-foreground">onebiz.com.vn/manager/otp</span> để cấp mã 6 số.
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Icon name="logout" size={14} className="mr-2" />
                Đăng xuất tất cả thiết bị
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start">
                <Icon name="lock_reset" size={14} className="mr-2" />
                Gửi link đặt lại mật khẩu
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start text-status-error hover:bg-status-error/10">
                <Icon name="block" size={14} className="mr-2" />
                {activeUser.isActive ? "Khoá tài khoản" : "Mở khoá"}
              </Button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

// ── TAB: OTP DUYỆT TỪ XA ──

const FLOW_STEPS = [
  {
    actor: "Cashier",
    text: "Bấm action nhạy cảm (vd Huỷ bill 500K). Hệ thống biết cashier không có quyền.",
    icon: "touch_app",
    color: "text-primary",
  },
  {
    actor: "POS",
    text: 'Hiển thị dialog "Cần OTP duyệt từ xa" — kèm danh sách quản lý phụ trách (tên + SĐT + Gọi/Zalo).',
    icon: "lock",
    color: "text-status-warning",
  },
  {
    actor: "Cashier",
    text: "Gọi điện hoặc nhắn Zalo cho quản lý phụ trách (xếp sẵn theo trạng thái: đang trong ca trước).",
    icon: "phone_in_talk",
    color: "text-primary",
  },
  {
    actor: "Manager",
    text: 'Mở web onebiz.com.vn/manager (hoặc PWA / app) → bấm "Cấp OTP" → đọc mã 6 số qua điện thoại.',
    icon: "vpn_key",
    color: "text-status-success",
  },
  {
    actor: "Cashier",
    text: "Nhập 6 số vào POS → server verify (TTL 2 phút, dùng 1 lần) → action được duyệt.",
    icon: "check_circle",
    color: "text-status-success",
  },
  {
    actor: "System",
    text: "Audit log ghi: cashier ABC bấm, manager XYZ duyệt, action gì, lúc nào, bill nào.",
    icon: "history_edu",
    color: "text-muted-foreground",
  },
];

const OTP_ACTION_CARDS = [
  {
    icon: "receipt_long",
    label: "Xoá bill chưa thanh toán",
    description: "Cashier bấm Huỷ bill — chưa thu tiền",
    color: "bg-status-warning/10 text-status-warning border-status-warning/30",
  },
  {
    icon: "remove_shopping_cart",
    label: "Xoá món chưa thanh toán",
    description: "Bỏ món khỏi order đã lưu",
    color: "bg-status-warning/10 text-status-warning border-status-warning/30",
  },
  {
    icon: "percent",
    label: "Giảm giá ngoài phạm vi",
    description: "Cashier muốn giảm > quota cho phép",
    color: "bg-primary/10 text-primary border-primary/30",
  },
  {
    icon: "edit_note",
    label: "Sửa món đã gửi bếp",
    description: "Thêm / bớt món sau khi đã gửi",
    color: "bg-primary/10 text-primary border-primary/30",
  },
  {
    icon: "money_off",
    label: "Huỷ bill đã thanh toán",
    description: "Hoàn tiền — tự cascade cash transaction",
    color: "bg-status-error/10 text-status-error border-status-error/30",
  },
  {
    icon: "person_remove",
    label: "Xoá khách hàng / NCC",
    description: "Xoá vĩnh viễn trong danh bạ",
    color: "bg-status-error/10 text-status-error border-status-error/30",
  },
];

const MOCK_OTP_HISTORY = [
  {
    time: "14:32",
    action: "Xoá bill chưa thanh toán",
    target: "B-2042 (500.000đ)",
    status: "used" as const,
    usedBy: "Trần Thị Bích",
  },
  {
    time: "13:15",
    action: "Giảm giá ngoài phạm vi",
    target: "Bill HD-1029 — giảm 30%",
    status: "used" as const,
    usedBy: "Trần Thị Bích",
  },
  {
    time: "12:08",
    action: "Xoá món chưa thanh toán",
    target: "Bill B-2038 — Cappuccino x2",
    status: "expired" as const,
    usedBy: null,
  },
  {
    time: "10:44",
    action: "Huỷ bill đã thanh toán",
    target: "B-2031 (1.200.000đ) — khách trả về",
    status: "used" as const,
    usedBy: "Lê Văn Cường",
  },
];

function OtpTab() {
  const [showDemo, setShowDemo] = useState(false);

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">OTP duyệt từ xa</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Manager không cần có mặt tại quán. Cashier gọi điện xin OTP — quản lý phụ trách (ai có quyền ở chi nhánh đó) cấp mã 6 số qua web/app, đọc qua điện thoại. Mã dùng 1 lần, hiệu lực 2 phút.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDemo(true)}
        >
          <Icon name="play_arrow" size={14} className="mr-1" />
          Xem demo modal cấp OTP
        </Button>
      </div>

      {/* Flow timeline */}
      <section>
        <h3 className="text-sm font-semibold mb-3">Quy trình 6 bước</h3>
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          {FLOW_STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-3 p-4">
              <div className="flex flex-col items-center">
                <div className="h-8 w-8 rounded-full bg-surface-container-low border border-border flex items-center justify-center font-semibold text-xs">
                  {i + 1}
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <div className="w-px h-6 bg-border mt-1" />
                )}
              </div>
              <div className="flex-1 pt-1">
                <div className="flex items-center gap-2 mb-1">
                  <Icon name={step.icon} size={14} className={step.color} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {step.actor}
                  </span>
                </div>
                <p className="text-sm text-foreground">{step.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 6 action cards */}
      <section>
        <h3 className="text-sm font-semibold mb-3">
          Áp dụng cho 6 action nhạy cảm (CEO chốt 12/05)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {OTP_ACTION_CARDS.map((a) => (
            <div
              key={a.label}
              className="p-4 rounded-xl border-2 border-border bg-surface"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 border",
                    a.color,
                  )}
                >
                  <Icon name={a.icon} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{a.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {a.description}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Stats + policy */}
      <section className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="schedule" size={14} /> Hiệu lực
          </div>
          <div className="text-base font-bold mt-1">2 phút</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Sau đó tự đổi mã mới
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="key" size={14} /> Số ký tự
          </div>
          <div className="text-base font-bold mt-1">6 số</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Random 000000-999999
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="security" size={14} /> Rate limit
          </div>
          <div className="text-base font-bold mt-1">5 / 15 phút</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Mỗi manager
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="warning" size={14} /> Sai 10 lần
          </div>
          <div className="text-base font-bold mt-1">Báo admin</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Không khoá (theo yêu cầu CEO)
          </div>
        </div>
      </section>

      {/* History */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">OTP gần nhất (demo)</h3>
          <Button variant="ghost" size="sm" className="text-xs h-7">
            <Icon name="refresh" size={14} className="mr-1" /> Làm mới
          </Button>
        </div>
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          {MOCK_OTP_HISTORY.map((r, i) => {
            const statusStyle =
              r.status === "used"
                ? "bg-status-success/10 text-status-success border-status-success/30"
                : "bg-muted text-muted-foreground border-border";
            const statusLabel =
              r.status === "used" ? `Đã dùng · ${r.usedBy}` : "Hết hạn";
            return (
              <div
                key={i}
                className="flex items-center gap-3 p-3 hover:bg-surface-container-low transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{r.action}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {r.target} · Hôm nay {r.time}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", statusStyle)}
                >
                  {statusLabel}
                </Badge>
              </div>
            );
          })}
        </div>
      </section>

      {/* Demo modal */}
      <OtpDemoModal open={showDemo} onClose={() => setShowDemo(false)} />
    </div>
  );
}

// Demo modal — bản preview cho CEO hiểu UX modal cấp OTP thật ở /manager/otp
function OtpDemoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(120);
  const demoCode = "847291";

  useEffect(() => {
    if (!open) return;
    setSecondsLeft(120);
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 120 : s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const progress = (secondsLeft / 120) * 100;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
      >
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="pin" size={18} className="text-status-warning" />
            <h3 className="font-bold">Mã OTP đã cấp (demo)</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-5">
            Đọc cho cashier qua điện thoại. Mã dùng được 1 lần trong 2 phút.
          </p>

          <div className="bg-status-warning/5 border border-status-warning/30 rounded-xl p-6 text-center mb-4">
            <div className="flex justify-center gap-2 mb-3">
              {demoCode.split("").map((d, i) => (
                <div
                  key={i}
                  className="h-14 w-12 rounded-lg flex items-center justify-center text-3xl font-bold font-mono bg-surface text-status-warning border border-status-warning/30"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-1.5 text-sm mb-2">
              <Icon name="timer" size={16} className="text-status-warning" />
              <span className="font-mono font-medium">
                {minutes}:{seconds.toString().padStart(2, "0")}
              </span>
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-status-warning transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground mb-4">
            <Icon
              name="phone_in_talk"
              size={14}
              className="inline-block mr-1 text-primary"
            />
            Đọc 6 số chậm rãi: "8 - 4 - 7 - 2 - 9 - 1". Tuyệt đối không chụp màn hình.
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm">
              <Icon name="content_copy" size={14} className="mr-1" />
              Sao chép
            </Button>
            <Button size="sm" onClick={onClose}>
              Đã đọc xong
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TAB: AUDIT ──

function AuditTab() {
  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold">Lịch sử thay đổi quyền</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Tracking đầy đủ: ai cấp/đổi/gỡ quyền, lúc nào, cho ai
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Tìm theo tên..." className="w-64 h-9" />
          <Button variant="outline" size="sm">
            <Icon name="download" size={14} className="mr-1" />
            Xuất Excel
          </Button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl divide-y divide-border">
        {MOCK_AUDIT.map((a, i) => (
          <div key={i} className="flex items-start gap-4 p-4 hover:bg-surface-container-low transition-colors">
            <div className="h-8 w-8 rounded-full bg-surface-container flex items-center justify-center shrink-0">
              <Icon name={a.icon} size={16} className={a.color} />
            </div>
            <div className="flex-1">
              <div className="text-sm">
                <span className="font-medium">{a.actor}</span>
                <span className="text-muted-foreground"> · </span>
                <span className={a.color}>{a.action}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{a.target}</div>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">{a.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
