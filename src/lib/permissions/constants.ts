/**
 * RBAC Permission System — Master permission codes + role templates.
 *
 * Codes: flat dot-notation strings stored in `role_permissions.permission_code`.
 * Groups: hierarchical grouping for the admin UI toggle grid.
 * Templates: default permissions for each system role.
 */

// ── Permission codes ──

export const PERMISSIONS = {
  // POS FnB
  POS_FNB_SEND_KITCHEN: "pos_fnb.send_kitchen",
  POS_FNB_VOID: "pos_fnb.void",
  POS_FNB_CANCEL_UNPAID_ORDER: "pos_fnb.cancel_unpaid_order",
  POS_FNB_VOID_PAID_BILL: "pos_fnb.void_paid_bill",
  POS_FNB_EDIT_SENT_ORDER: "pos_fnb.edit_sent_order",
  POS_FNB_DISCOUNT: "pos_fnb.discount",
  POS_FNB_VIEW_ORDERS: "pos_fnb.view_orders",
  POS_FNB_MANAGE_TABLES: "pos_fnb.manage_tables",
  POS_FNB_SPLIT_BILL: "pos_fnb.split_bill",
  POS_FNB_TRANSFER_TABLE: "pos_fnb.transfer_table",

  // POS Retail
  POS_RETAIL_CHECKOUT: "pos_retail.checkout",
  POS_RETAIL_VOID: "pos_retail.void",
  POS_RETAIL_DISCOUNT: "pos_retail.discount",
  POS_RETAIL_SAVE_DRAFT: "pos_retail.save_draft",

  // Inventory / Warehouse
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_ADJUST: "inventory.adjust",
  INVENTORY_CREATE_PO: "inventory.create_po",
  INVENTORY_DISPOSE: "inventory.dispose",
  INVENTORY_INTERNAL_EXPORT: "inventory.internal_export",
  INVENTORY_TRANSFER: "inventory.transfer",
  INVENTORY_CHECK: "inventory.check",

  // Finance
  FINANCE_VIEW_CASH_BOOK: "finance.view_cash_book",
  FINANCE_CREATE_TRANSACTION: "finance.create_transaction",
  FINANCE_VIEW_REPORTS: "finance.view_reports",
  FINANCE_VOID_TRANSACTION: "finance.void_transaction",

  // Products
  PRODUCTS_VIEW: "products.view",
  PRODUCTS_CREATE: "products.create",
  PRODUCTS_EDIT: "products.edit",
  PRODUCTS_DELETE: "products.delete",
  PRODUCTS_MANAGE_PRICES: "products.manage_prices",
  // Phase 5 (CEO 12/05): chi tiết hơn để phân quyền sát thực tế (tham khảo KiotViet/Sapo).
  PRODUCTS_VIEW_COST: "products.view_cost",          // ẩn giá vốn khỏi cashier
  PRODUCTS_VIEW_PROFIT: "products.view_profit",      // ẩn lợi nhuận
  PRODUCTS_IMPORT: "products.import",                // Excel bulk import
  PRODUCTS_EXPORT: "products.export",                // Excel export
  PRODUCTS_PRINT_BARCODE: "products.print_barcode",  // in tem
  PRODUCTS_DUPLICATE: "products.duplicate",          // sao chép sản phẩm

  // Customers
  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_CREATE: "customers.create",
  CUSTOMERS_EDIT: "customers.edit",
  CUSTOMERS_DELETE: "customers.delete",
  CUSTOMERS_VIEW_DEBT: "customers.view_debt",        // ẩn công nợ khỏi cashier
  CUSTOMERS_IMPORT: "customers.import",
  CUSTOMERS_EXPORT: "customers.export",

  // Suppliers
  SUPPLIERS_VIEW: "suppliers.view",
  SUPPLIERS_CREATE: "suppliers.create",
  SUPPLIERS_EDIT: "suppliers.edit",
  SUPPLIERS_DELETE: "suppliers.delete",
  SUPPLIERS_VIEW_DEBT: "suppliers.view_debt",
  SUPPLIERS_IMPORT: "suppliers.import",
  SUPPLIERS_EXPORT: "suppliers.export",

  // Orders
  ORDERS_VIEW: "orders.view",
  ORDERS_CREATE: "orders.create",
  ORDERS_CANCEL: "orders.cancel",
  ORDERS_PRINT: "orders.print",
  ORDERS_EXPORT: "orders.export",
  ORDERS_VIEW_OWN_ONLY: "orders.view_own_only",      // constraint: chỉ xem đơn của mình

  // Invoices
  INVOICES_VIEW: "invoices.view",
  INVOICES_PRINT: "invoices.print",
  INVOICES_EXPORT: "invoices.export",

  // System
  SYSTEM_MANAGE_USERS: "system.manage_users",
  SYSTEM_MANAGE_BRANCHES: "system.manage_branches",
  SYSTEM_MANAGE_ROLES: "system.manage_roles",
  SYSTEM_VIEW_AUDIT: "system.view_audit",
  SYSTEM_ISSUE_OTP: "system.issue_otp",              // cấp OTP duyệt từ xa cho thao tác nhạy cảm

  // Reports
  REPORTS_DASHBOARD: "reports.dashboard",
  REPORTS_ANALYTICS: "reports.analytics",
  REPORTS_FNB: "reports.fnb",
  REPORTS_EXPORT: "reports.export",
  REPORTS_VIEW_PROFIT: "reports.view_profit",        // ẩn báo cáo lợi nhuận khỏi cashier
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All permission codes as an array */
export const ALL_PERMISSION_CODES: PermissionCode[] = Object.values(PERMISSIONS);

// ── Permission groups (for admin UI toggle grid) ──

export interface PermissionItem {
  code: PermissionCode;
  label: string;
}

export interface PermissionGroup {
  group: string;
  permissions: PermissionItem[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    group: "POS FnB",
    permissions: [
      { code: PERMISSIONS.POS_FNB_SEND_KITCHEN, label: "Gửi bếp" },
      { code: PERMISSIONS.POS_FNB_VOID, label: "Hủy hóa đơn" },
      { code: PERMISSIONS.POS_FNB_CANCEL_UNPAID_ORDER, label: "Hủy đơn chưa thanh toán" },
      { code: PERMISSIONS.POS_FNB_VOID_PAID_BILL, label: "Hủy bill đã thanh toán" },
      { code: PERMISSIONS.POS_FNB_EDIT_SENT_ORDER, label: "Sửa món đã gửi bếp" },
      { code: PERMISSIONS.POS_FNB_DISCOUNT, label: "Áp giảm giá" },
      { code: PERMISSIONS.POS_FNB_VIEW_ORDERS, label: "Xem đơn bếp" },
      { code: PERMISSIONS.POS_FNB_MANAGE_TABLES, label: "Quản lý bàn" },
      { code: PERMISSIONS.POS_FNB_SPLIT_BILL, label: "Tách bill" },
      { code: PERMISSIONS.POS_FNB_TRANSFER_TABLE, label: "Chuyển bàn" },
    ],
  },
  {
    group: "POS Retail",
    permissions: [
      { code: PERMISSIONS.POS_RETAIL_CHECKOUT, label: "Thanh toán" },
      { code: PERMISSIONS.POS_RETAIL_VOID, label: "Hủy hóa đơn" },
      { code: PERMISSIONS.POS_RETAIL_DISCOUNT, label: "Áp giảm giá" },
      { code: PERMISSIONS.POS_RETAIL_SAVE_DRAFT, label: "Lưu nháp" },
    ],
  },
  {
    group: "Kho hàng",
    permissions: [
      { code: PERMISSIONS.INVENTORY_VIEW, label: "Xem tồn kho" },
      { code: PERMISSIONS.INVENTORY_ADJUST, label: "Điều chỉnh kho" },
      { code: PERMISSIONS.INVENTORY_CREATE_PO, label: "Tạo phiếu nhập" },
      { code: PERMISSIONS.INVENTORY_DISPOSE, label: "Xuất hủy" },
      { code: PERMISSIONS.INVENTORY_INTERNAL_EXPORT, label: "Xuất nội bộ" },
      { code: PERMISSIONS.INVENTORY_TRANSFER, label: "Chuyển kho" },
      { code: PERMISSIONS.INVENTORY_CHECK, label: "Kiểm kho" },
    ],
  },
  {
    group: "Tài chính",
    permissions: [
      { code: PERMISSIONS.FINANCE_VIEW_CASH_BOOK, label: "Xem sổ quỹ" },
      { code: PERMISSIONS.FINANCE_CREATE_TRANSACTION, label: "Tạo phiếu thu/chi" },
      { code: PERMISSIONS.FINANCE_VIEW_REPORTS, label: "Xem báo cáo" },
      { code: PERMISSIONS.FINANCE_VOID_TRANSACTION, label: "Hủy giao dịch" },
    ],
  },
  {
    group: "Sản phẩm",
    permissions: [
      { code: PERMISSIONS.PRODUCTS_VIEW, label: "Xem sản phẩm" },
      { code: PERMISSIONS.PRODUCTS_CREATE, label: "Thêm sản phẩm" },
      { code: PERMISSIONS.PRODUCTS_EDIT, label: "Sửa sản phẩm" },
      { code: PERMISSIONS.PRODUCTS_DELETE, label: "Xóa sản phẩm" },
      { code: PERMISSIONS.PRODUCTS_DUPLICATE, label: "Sao chép sản phẩm" },
      { code: PERMISSIONS.PRODUCTS_MANAGE_PRICES, label: "Quản lý giá bán" },
      { code: PERMISSIONS.PRODUCTS_VIEW_COST, label: "Xem giá vốn" },
      { code: PERMISSIONS.PRODUCTS_VIEW_PROFIT, label: "Xem lợi nhuận" },
      { code: PERMISSIONS.PRODUCTS_IMPORT, label: "Nhập Excel" },
      { code: PERMISSIONS.PRODUCTS_EXPORT, label: "Xuất Excel" },
      { code: PERMISSIONS.PRODUCTS_PRINT_BARCODE, label: "In tem mã vạch" },
    ],
  },
  {
    group: "Khách hàng",
    permissions: [
      { code: PERMISSIONS.CUSTOMERS_VIEW, label: "Xem khách hàng" },
      { code: PERMISSIONS.CUSTOMERS_CREATE, label: "Thêm khách hàng" },
      { code: PERMISSIONS.CUSTOMERS_EDIT, label: "Sửa khách hàng" },
      { code: PERMISSIONS.CUSTOMERS_DELETE, label: "Xóa khách hàng" },
      { code: PERMISSIONS.CUSTOMERS_VIEW_DEBT, label: "Xem công nợ" },
      { code: PERMISSIONS.CUSTOMERS_IMPORT, label: "Nhập Excel" },
      { code: PERMISSIONS.CUSTOMERS_EXPORT, label: "Xuất Excel" },
    ],
  },
  {
    group: "Nhà cung cấp",
    permissions: [
      { code: PERMISSIONS.SUPPLIERS_VIEW, label: "Xem NCC" },
      { code: PERMISSIONS.SUPPLIERS_CREATE, label: "Thêm NCC" },
      { code: PERMISSIONS.SUPPLIERS_EDIT, label: "Sửa NCC" },
      { code: PERMISSIONS.SUPPLIERS_DELETE, label: "Xóa NCC" },
      { code: PERMISSIONS.SUPPLIERS_VIEW_DEBT, label: "Xem công nợ NCC" },
      { code: PERMISSIONS.SUPPLIERS_IMPORT, label: "Nhập Excel" },
      { code: PERMISSIONS.SUPPLIERS_EXPORT, label: "Xuất Excel" },
    ],
  },
  {
    group: "Đơn hàng",
    permissions: [
      { code: PERMISSIONS.ORDERS_VIEW, label: "Xem đơn hàng" },
      { code: PERMISSIONS.ORDERS_VIEW_OWN_ONLY, label: "Chỉ xem đơn của mình" },
      { code: PERMISSIONS.ORDERS_CREATE, label: "Tạo đơn" },
      { code: PERMISSIONS.ORDERS_CANCEL, label: "Hủy đơn" },
      { code: PERMISSIONS.ORDERS_PRINT, label: "In đơn" },
      { code: PERMISSIONS.ORDERS_EXPORT, label: "Xuất Excel" },
    ],
  },
  {
    group: "Hóa đơn",
    permissions: [
      { code: PERMISSIONS.INVOICES_VIEW, label: "Xem hóa đơn" },
      { code: PERMISSIONS.INVOICES_PRINT, label: "In hóa đơn" },
      { code: PERMISSIONS.INVOICES_EXPORT, label: "Xuất Excel" },
    ],
  },
  {
    group: "Hệ thống",
    permissions: [
      { code: PERMISSIONS.SYSTEM_MANAGE_USERS, label: "Quản lý người dùng" },
      { code: PERMISSIONS.SYSTEM_MANAGE_BRANCHES, label: "Quản lý chi nhánh" },
      { code: PERMISSIONS.SYSTEM_MANAGE_ROLES, label: "Quản lý vai trò" },
      { code: PERMISSIONS.SYSTEM_VIEW_AUDIT, label: "Xem lịch sử thao tác" },
      { code: PERMISSIONS.SYSTEM_ISSUE_OTP, label: "Cấp OTP duyệt từ xa" },
    ],
  },
  {
    group: "Báo cáo",
    permissions: [
      { code: PERMISSIONS.REPORTS_DASHBOARD, label: "Dashboard" },
      { code: PERMISSIONS.REPORTS_ANALYTICS, label: "Phân tích" },
      { code: PERMISSIONS.REPORTS_FNB, label: "Báo cáo F&B" },
      { code: PERMISSIONS.REPORTS_VIEW_PROFIT, label: "Báo cáo lợi nhuận" },
      { code: PERMISSIONS.REPORTS_EXPORT, label: "Xuất báo cáo" },
    ],
  },
];

// ── Default role templates ──

export interface RoleTemplate {
  name: string;
  description: string;
  legacyRole: string; // maps to profiles.role text
  color: string;
  permissions: PermissionCode[];
}

export const DEFAULT_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    name: "Chủ cửa hàng",
    description: "Toàn quyền quản lý hệ thống",
    legacyRole: "owner",
    color: "bg-red-500",
    permissions: ALL_PERMISSION_CODES, // all
  },
  {
    name: "Admin",
    description: "Quản trị hệ thống (trừ phân quyền)",
    legacyRole: "admin",
    color: "bg-purple-500",
    permissions: ALL_PERMISSION_CODES.filter((c) => c !== PERMISSIONS.SYSTEM_MANAGE_ROLES),
  },
  {
    name: "Quản lý",
    description: "Quản lý hoạt động cửa hàng và chi nhánh, cấp OTP duyệt từ xa",
    legacyRole: "manager",
    color: "bg-primary",
    permissions: [
      // POS full
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("pos_")),
      // Inventory full
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("inventory.")),
      // Finance view + create
      PERMISSIONS.FINANCE_VIEW_CASH_BOOK,
      PERMISSIONS.FINANCE_CREATE_TRANSACTION,
      PERMISSIONS.FINANCE_VIEW_REPORTS,
      // Products full (cả view_cost + view_profit)
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("products.")),
      // Customers full
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("customers.")),
      // Suppliers full
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("suppliers.")),
      // Orders full
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("orders.")),
      // Invoices full
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("invoices.")),
      // Reports
      PERMISSIONS.REPORTS_DASHBOARD,
      PERMISSIONS.REPORTS_ANALYTICS,
      PERMISSIONS.REPORTS_FNB,
      PERMISSIONS.REPORTS_VIEW_PROFIT,
      PERMISSIONS.REPORTS_EXPORT,
      // System: cấp OTP + xem audit
      PERMISSIONS.SYSTEM_VIEW_AUDIT,
      PERMISSIONS.SYSTEM_ISSUE_OTP,
    ],
  },
  {
    name: "Thu ngân F&B",
    description: "Bán hàng F&B, thu tiền, xem đơn bếp",
    legacyRole: "cashier",
    color: "bg-green-500",
    permissions: [
      PERMISSIONS.POS_FNB_SEND_KITCHEN,
      PERMISSIONS.POS_FNB_VIEW_ORDERS,
      PERMISSIONS.POS_FNB_SPLIT_BILL,
      PERMISSIONS.POS_FNB_TRANSFER_TABLE,
      PERMISSIONS.FINANCE_VIEW_CASH_BOOK,
      PERMISSIONS.PRODUCTS_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.CUSTOMERS_CREATE,
    ],
  },
  {
    name: "Phục vụ",
    description: "Nhận order, quản lý bàn, gửi bếp",
    legacyRole: "staff",
    color: "bg-teal-500",
    permissions: [
      PERMISSIONS.POS_FNB_SEND_KITCHEN,
      PERMISSIONS.POS_FNB_VIEW_ORDERS,
      PERMISSIONS.POS_FNB_MANAGE_TABLES,
      PERMISSIONS.POS_FNB_TRANSFER_TABLE,
      PERMISSIONS.PRODUCTS_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW,
    ],
  },
  {
    name: "Kho vận",
    description: "Quản lý kho hàng, nhập xuất, kiểm kho",
    legacyRole: "staff",
    color: "bg-orange-500",
    permissions: [
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("inventory.")),
      PERMISSIONS.PRODUCTS_VIEW,
      PERMISSIONS.SUPPLIERS_VIEW,
    ],
  },
  {
    name: "Kế toán",
    description: "Quản lý tài chính, báo cáo, công nợ",
    legacyRole: "staff",
    color: "bg-indigo-500",
    permissions: [
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("finance.")),
      ...ALL_PERMISSION_CODES.filter((c) => c.startsWith("reports.")),
      PERMISSIONS.ORDERS_VIEW,
      PERMISSIONS.PRODUCTS_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.SUPPLIERS_VIEW,
    ],
  },
];
