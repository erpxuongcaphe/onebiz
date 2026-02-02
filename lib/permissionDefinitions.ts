/**
 * Centralized Permission Definitions
 * Defines all permissions in the system with descriptions
 * Used for:
 * - Role management UI
 * - Special permissions assignment
 * - Permission display and search
 */

export type PermissionModule = {
  label: string;
  permissions: {
    code: string;
    label: string;
    description?: string;
  }[];
};

export const PERMISSION_DEFINITIONS: Record<string, PermissionModule> = {
  inventory: {
    label: 'Quản Lý Kho',
    permissions: [
      { code: 'inventory.read', label: 'Xem kho hàng', description: 'Xem danh sách sản phẩm và tồn kho' },
      { code: 'inventory.product.*', label: 'Quản lý sản phẩm (tất cả)', description: 'Tạo, sửa, xóa sản phẩm' },
      { code: 'inventory.product.create', label: 'Tạo sản phẩm' },
      { code: 'inventory.product.update', label: 'Sửa sản phẩm' },
      { code: 'inventory.product.delete', label: 'Xóa sản phẩm' },
      { code: 'inventory.stock.adjust', label: 'Điều chỉnh tồn kho', description: 'Nhập/xuất/kiểm kê tồn kho' },
      { code: 'inventory.movement.read', label: 'Xem lịch sử xuất nhập' },
    ]
  },
  sales: {
    label: 'Bán Hàng',
    permissions: [
      { code: 'sales_orders.*', label: 'Quản lý đơn hàng (tất cả)', description: 'Xem, tạo, sửa, xác nhận, hủy đơn' },
      { code: 'sales_orders.view', label: 'Xem đơn hàng' },
      { code: 'sales_orders.create', label: 'Tạo đơn hàng' },
      { code: 'sales_orders.update', label: 'Sửa đơn hàng' },
      { code: 'sales_orders.confirm', label: 'Xác nhận đơn hàng' },
      { code: 'sales_orders.cancel', label: 'Hủy đơn hàng' },
    ]
  },
  finance: {
    label: 'Tài Chính',
    permissions: [
      { code: 'finance.*', label: 'Quản lý tài chính (tất cả)' },
      { code: 'finance.read', label: 'Xem báo cáo tài chính' },
      { code: 'finance.export', label: 'Xuất báo cáo tài chính', description: 'Xuất Excel/PDF báo cáo doanh thu, lợi nhuận' },
      { code: 'finance.approve', label: 'Duyệt phiếu thu/chi' },
    ]
  },
  reports: {
    label: 'Báo Cáo',
    permissions: [
      { code: 'reports.*', label: 'Xem tất cả báo cáo' },
      { code: 'reports.sales', label: 'Báo cáo bán hàng' },
      { code: 'reports.inventory', label: 'Báo cáo tồn kho' },
      { code: 'reports.salary.view', label: 'Xem báo cáo lương', description: 'Báo cáo lương nhân viên (nhạy cảm)' },
    ]
  },
  users: {
    label: 'Quản Lý User',
    permissions: [
      { code: 'users.*', label: 'Quản lý users (tất cả)' },
      { code: 'users.manage', label: 'Quản lý tài khoản', description: 'Tạo, sửa, khóa/mở khóa user' },
      { code: 'users.password.reset', label: 'Reset mật khẩu user' },
      { code: 'users.permissions.manage', label: 'Gán quyền đặc biệt', description: 'Thêm/xóa quyền riêng cho từng user' },
    ]
  },
  pos: {
    label: 'POS',
    permissions: [
      { code: 'pos.*', label: 'POS (tất cả)' },
      { code: 'pos.shift.open', label: 'Mở ca' },
      { code: 'pos.order.create', label: 'Tạo đơn POS' },
      { code: 'pos.payment.record', label: 'Ghi nhận thanh toán' },
    ]
  },
  settings: {
    label: 'Cài Đặt',
    permissions: [
      { code: 'settings.*', label: 'Cài đặt (tất cả)' },
      { code: 'settings.company.update', label: 'Cập nhật thông tin công ty' },
      { code: 'settings.branches.manage', label: 'Quản lý chi nhánh' },
      { code: 'settings.roles.manage', label: 'Quản lý vai trò' },
    ]
  }
};

/**
 * Get all permission codes as flat array
 */
export function getAllPermissionCodes(): string[] {
  return Object.values(PERMISSION_DEFINITIONS)
    .flatMap(module => module.permissions.map(p => p.code));
}

/**
 * Get permission label by code
 */
export function getPermissionLabel(code: string): string {
  for (const module of Object.values(PERMISSION_DEFINITIONS)) {
    const perm = module.permissions.find(p => p.code === code);
    if (perm) return perm.label;
  }
  return code; // Fallback to code itself
}

/**
 * Get permission description by code
 */
export function getPermissionDescription(code: string): string | undefined {
  for (const module of Object.values(PERMISSION_DEFINITIONS)) {
    const perm = module.permissions.find(p => p.code === code);
    if (perm) return perm.description;
  }
  return undefined;
}

/**
 * Get module name by permission code
 */
export function getPermissionModule(code: string): string {
  for (const [moduleKey, module] of Object.entries(PERMISSION_DEFINITIONS)) {
    if (module.permissions.some(p => p.code === code)) {
      return module.label;
    }
  }
  return 'Khác';
}

/**
 * Search permissions by keyword (code or label)
 */
export function searchPermissions(keyword: string): { code: string; label: string; module: string }[] {
  const lowerKeyword = keyword.toLowerCase();
  const results: { code: string; label: string; module: string }[] = [];

  for (const [moduleKey, module] of Object.entries(PERMISSION_DEFINITIONS)) {
    for (const perm of module.permissions) {
      if (
        perm.code.toLowerCase().includes(lowerKeyword) ||
        perm.label.toLowerCase().includes(lowerKeyword) ||
        perm.description?.toLowerCase().includes(lowerKeyword)
      ) {
        results.push({
          code: perm.code,
          label: perm.label,
          module: module.label
        });
      }
    }
  }

  return results;
}
