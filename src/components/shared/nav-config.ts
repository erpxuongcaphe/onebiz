// ============================================================
// LEGACY NAV (top-nav.tsx + mobile-bottom-nav.tsx still use these)
// Keep exported until M3 finishes header refactor.
// ============================================================

export interface NavItem {
  label: string;
  href: string;
}

export interface NavGroup {
  label: string;
  href?: string;
  items?: {
    groupLabel?: string;
    items: NavItem[];
  }[];
}

export const mainNavItems: NavGroup[] = [
  {
    label: "Tổng quan",
    href: "/",
  },
  {
    label: "Hàng hóa",
    items: [
      {
        groupLabel: "Hàng hóa",
        items: [
          { label: "Danh sách hàng hóa", href: "/hang-hoa" },
          { label: "Thiết lập giá", href: "/hang-hoa/thiet-lap-gia" },
        ],
      },
      {
        groupLabel: "Sản xuất",
        items: [
          { label: "Lệnh sản xuất", href: "/hang-hoa/san-xuat" },
          { label: "Công thức (BOM)", href: "/hang-hoa/cong-thuc" },
          { label: "Hạn sử dụng (HSD)", href: "/hang-hoa/hsd" },
        ],
      },
      {
        groupLabel: "Kho hàng",
        items: [
          { label: "Tồn kho", href: "/hang-hoa/ton-kho" },
          { label: "Kiểm kho", href: "/hang-hoa/kiem-kho" },
          { label: "Bán nội bộ", href: "/hang-hoa/ban-noi-bo" },
          { label: "Xuất dùng nội bộ", href: "/hang-hoa/xuat-dung-noi-bo" },
          { label: "Xuất hủy", href: "/hang-hoa/xuat-huy" },
        ],
      },
      {
        groupLabel: "Nhập hàng",
        items: [
          { label: "Hóa đơn đầu vào", href: "/hang-hoa/hoa-don-dau-vao" },
          { label: "Nhà cung cấp", href: "/hang-hoa/nha-cung-cap" },
          { label: "Đặt hàng nhập", href: "/hang-hoa/dat-hang-nhap" },
          { label: "Nhập hàng", href: "/hang-hoa/nhap-hang" },
          { label: "Trả hàng nhập", href: "/hang-hoa/tra-hang-nhap" },
        ],
      },
    ],
  },
  {
    label: "Đơn hàng",
    items: [
      {
        items: [
          { label: "Đặt hàng", href: "/don-hang/dat-hang" },
          { label: "Hóa đơn", href: "/don-hang/hoa-don" },
          { label: "Trả hàng", href: "/don-hang/tra-hang" },
          { label: "Đối tác giao hàng", href: "/don-hang/doi-tac-giao-hang" },
          { label: "Vận đơn", href: "/don-hang/van-don" },
        ],
      },
    ],
  },
  {
    label: "Khách hàng",
    items: [
      {
        items: [
          { label: "Danh sách khách hàng", href: "/khach-hang" },
          { label: "Nhóm khách hàng", href: "/khach-hang/nhom" },
        ],
      },
    ],
  },
  {
    label: "Tài chính",
    items: [
      {
        items: [
          { label: "Sổ quỹ", href: "/so-quy" },
          { label: "Công nợ", href: "/tai-chinh/cong-no" },
        ],
      },
    ],
  },
  {
    label: "Phân tích",
    href: "/phan-tich",
  },
  {
    label: "Bán online",
    href: "/ban-online",
  },
];

// ============================================================
// SIDEBAR V2 — for app-sidebar.tsx (M2 onwards)
// 5 phân hệ + Hệ thống pinned bottom
// Icons → Material Symbols Outlined (string names). Render via <Icon name=... />
// ============================================================

export type SidebarMode = "admin" | "pos";

export interface SidebarLeaf {
  label: string;
  href: string;
  /** Material Symbols Outlined name, e.g. "home", "shopping_cart" */
  icon?: string;
  /** Disable click + dim style. Combine with `comingSoon` to show "Soon" badge. */
  disabled?: boolean;
  comingSoon?: boolean;
  /** "pos" => opens full-screen POS layout (no sidebar). */
  mode?: SidebarMode;
  /** Optional badge text shown on the right. */
  badge?: string;
  /** Permission code required to see this item. Owner always sees all. */
  permission?: string;
}

export interface SidebarSubGroup {
  label: string;
  icon?: string;
  items: SidebarLeaf[];
}

export interface SidebarGroup {
  label: string;
  icon: string;
  /** Either flat items OR sub-groups (mutually exclusive). */
  items?: SidebarLeaf[];
  subGroups?: SidebarSubGroup[];
  /** If true, the group is rendered in the bottom-pinned section. */
  pinBottom?: boolean;
}

export const sidebarNavGroups: SidebarGroup[] = [
  // 1. Tổng quan AI
  {
    label: "Tổng quan AI",
    icon: "auto_awesome",
    items: [
      { label: "Trang chủ AI", href: "/", icon: "home" },
      // /ai/phan-tich + /ai/import chưa có page (404 trên production →
      // RSC failed to load → trigger error boundary). Mark comingSoon
      // để render disabled item, không navigate.
      {
        label: "Phân tích kinh doanh",
        href: "/ai/phan-tich",
        icon: "bar_chart",
        disabled: true,
        comingSoon: true,
      },
      {
        label: "Import dữ liệu",
        href: "/ai/import",
        icon: "upload",
        disabled: true,
        comingSoon: true,
      },
      { label: "AI Agents", href: "/ai-agents", icon: "smart_toy", badge: "New" },
      { label: "KPI Breakdown", href: "/ai-agents/kpi", icon: "trending_up" },
      { label: "Task hàng ngày", href: "/ai-agents/tasks", icon: "checklist" },
      {
        label: "Trò chuyện AI",
        href: "/ai/chat",
        icon: "chat",
        disabled: true,
        comingSoon: true,
      },
    ],
  },

  // 2. Bán hàng — REV 2: bỏ POS lẻ, focus B2B + Online
  {
    label: "Bán hàng",
    icon: "shopping_cart",
    items: [
      { label: "POS", href: "/pos", icon: "point_of_sale", mode: "pos", permission: "pos_retail.checkout" },
      { label: "POS F&B", href: "/pos/fnb", icon: "coffee", mode: "pos", permission: "pos_fnb.send_kitchen" },
      { label: "Màn hình bếp (KDS)", href: "/pos/fnb/kds", icon: "restaurant", mode: "pos", permission: "pos_fnb.view_orders" },
      { label: "Bán online", href: "/ban-online", icon: "public" },
      { label: "Đơn đặt hàng", href: "/don-hang/dat-hang", icon: "description" },
      { label: "Hóa đơn", href: "/don-hang/hoa-don", icon: "receipt_long" },
      { label: "Trả hàng", href: "/don-hang/tra-hang", icon: "undo" },
    ],
  },

  // 3. Hàng hóa
  {
    label: "Hàng hóa",
    icon: "inventory_2",
    subGroups: [
      {
        label: "Sản phẩm",
        icon: "category",
        items: [
          { label: "Danh sách hàng", href: "/hang-hoa", icon: "inventory_2" },
          { label: "Nhóm hàng", href: "/hang-hoa/nhom", icon: "sell" },
          { label: "Đơn vị tính", href: "/hang-hoa/don-vi-tinh", icon: "straighten" },
          { label: "Bảng giá", href: "/hang-hoa/thiet-lap-gia", icon: "attach_money" },
        ],
      },
      {
        label: "Kho",
        icon: "warehouse",
        items: [
          { label: "Tồn kho", href: "/hang-hoa/ton-kho", icon: "warehouse" },
          { label: "Lịch sử kho", href: "/hang-hoa/lich-su-kho", icon: "history" },
          { label: "Kiểm kho", href: "/hang-hoa/kiem-kho", icon: "fact_check" },
          { label: "Hạn sử dụng (HSD)", href: "/hang-hoa/hsd", icon: "event_note" },
          { label: "Xuất hủy", href: "/hang-hoa/xuat-huy", icon: "delete" },
          { label: "Xuất dùng nội bộ", href: "/hang-hoa/xuat-dung-noi-bo", icon: "inventory" },
        ],
      },
      {
        label: "Sản xuất",
        icon: "factory",
        items: [
          { label: "Dashboard Sản xuất", href: "/san-xuat", icon: "bar_chart" },
          { label: "Lệnh sản xuất", href: "/hang-hoa/san-xuat", icon: "factory" },
          { label: "Công thức (BOM)", href: "/hang-hoa/cong-thuc", icon: "schema" },
          { label: "Lô sản xuất", href: "/hang-hoa/lo-san-xuat", icon: "inventory_2" },
        ],
      },
    ],
  },

  // 4. Giao dịch
  {
    label: "Giao dịch",
    icon: "swap_horiz",
    subGroups: [
      {
        label: "Nội bộ",
        icon: "swap_horiz",
        items: [
          { label: "Bán nội bộ", href: "/hang-hoa/ban-noi-bo", icon: "swap_horiz" },
          { label: "Chuyển kho", href: "/hang-hoa/chuyen-kho", icon: "local_shipping" },
        ],
      },
      {
        label: "Mua hàng",
        icon: "add_box",
        items: [
          { label: "Đặt hàng nhập", href: "/hang-hoa/dat-hang-nhap", icon: "description" },
          { label: "Nhập hàng", href: "/hang-hoa/nhap-hang", icon: "add_box" },
          { label: "Trả hàng nhập", href: "/hang-hoa/tra-hang-nhap", icon: "undo" },
        ],
      },
      {
        label: "Vận chuyển",
        icon: "local_shipping",
        items: [
          { label: "Vận đơn", href: "/don-hang/van-don", icon: "local_shipping" },
        ],
      },
      {
        label: "Tài chính",
        icon: "payments",
        items: [
          { label: "Sổ quỹ", href: "/so-quy", icon: "payments" },
          { label: "Công nợ", href: "/tai-chinh/cong-no", icon: "credit_card" },
        ],
      },
    ],
  },

  // 5. Đối tác
  {
    label: "Đối tác",
    icon: "group",
    items: [
      { label: "Khách hàng", href: "/khach-hang", icon: "group" },
      { label: "Nhóm khách hàng", href: "/khach-hang/nhom", icon: "sell" },
      { label: "Nhà cung cấp", href: "/doi-tac/ncc", icon: "apartment" },
      { label: "Đối tác giao hàng", href: "/doi-tac/giao-hang", icon: "local_shipping" },
    ],
  },

  // 6. Hệ thống — pinned bottom
  {
    label: "Hệ thống",
    icon: "settings",
    pinBottom: true,
    items: [
      { label: "Người dùng & phân quyền", href: "/he-thong/users", icon: "manage_accounts", permission: "system.manage_users" },
      { label: "Chi nhánh", href: "/he-thong/chi-nhanh", icon: "apartment", permission: "system.manage_branches" },
      { label: "Bàn & Khu vực F&B", href: "/he-thong/quan-ly-ban", icon: "chair" },
      { label: "Thiết lập chung", href: "/he-thong/thiet-lap", icon: "settings" },
      { label: "Tích hợp", href: "/he-thong/tich-hop", icon: "power" },
      { label: "Lịch sử thao tác", href: "/he-thong/audit", icon: "pending_actions", permission: "system.view_audit" },
    ],
  },
];

/**
 * Helper: returns true if the current pathname matches the given href
 * (exact match, or pathname starts with `href + "/"`).
 * Special case: href "/" only matches exact "/".
 */
export function isHrefActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Helper: returns true if any leaf inside the group matches the current pathname.
 */
export function isGroupActive(pathname: string, group: SidebarGroup): boolean {
  if (group.items?.some((leaf) => isHrefActive(pathname, leaf.href))) return true;
  if (
    group.subGroups?.some((sg) =>
      sg.items.some((leaf) => isHrefActive(pathname, leaf.href))
    )
  ) {
    return true;
  }
  return false;
}
