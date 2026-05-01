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
  // ============================================================
  // 1. TỔNG QUAN — Dashboard + Phân tích + Cảnh báo
  // ============================================================
  // Owner cà phê chain mở app buổi sáng → cần biết NGAY: doanh số,
  // cảnh báo (tồn thấp / nợ quá hạn / lô hết hạn). Đặt đầu tiên.
  {
    label: "Tổng quan",
    icon: "dashboard",
    items: [
      { label: "Trang chủ", href: "/", icon: "home" },
      { label: "Phân tích", href: "/phan-tich", icon: "insights" },
      { label: "Cảnh báo", href: "/phan-tich/canh-bao", icon: "warning" },
      { label: "Báo cáo tài chính", href: "/phan-tich/bao-cao-tai-chinh", icon: "summarize" },
    ],
  },

  // ============================================================
  // 2. BÁN HÀNG — POS + sales documents
  // ============================================================
  {
    label: "Bán hàng",
    icon: "shopping_cart",
    items: [
      { label: "POS Bán lẻ", href: "/pos", icon: "point_of_sale", mode: "pos", permission: "pos_retail.checkout" },
      { label: "POS F&B", href: "/pos/fnb", icon: "coffee", mode: "pos", permission: "pos_fnb.send_kitchen" },
      { label: "Màn hình bếp (KDS)", href: "/pos/fnb/kds", icon: "restaurant", mode: "pos", permission: "pos_fnb.view_orders" },
      { label: "Bán online", href: "/ban-online", icon: "public" },
      { label: "Đơn đặt hàng", href: "/don-hang/dat-hang", icon: "description" },
      { label: "Hóa đơn", href: "/don-hang/hoa-don", icon: "receipt_long" },
      { label: "Trả hàng", href: "/don-hang/tra-hang", icon: "undo" },
      { label: "Vận đơn", href: "/don-hang/van-don", icon: "local_shipping" },
    ],
  },

  // ============================================================
  // 3. HÀNG HÓA — products + warehouse + production
  // ============================================================
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
          { label: "Chuyển kho", href: "/hang-hoa/chuyen-kho", icon: "swap_horiz" },
          { label: "Hạn sử dụng (HSD)", href: "/hang-hoa/hsd", icon: "event_note" },
          { label: "Xuất dùng nội bộ", href: "/hang-hoa/xuat-dung-noi-bo", icon: "inventory" },
          { label: "Xuất hủy", href: "/hang-hoa/xuat-huy", icon: "delete" },
          { label: "Bán nội bộ", href: "/hang-hoa/ban-noi-bo", icon: "store" },
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
      {
        label: "Mua hàng",
        icon: "add_box",
        items: [
          { label: "Đặt hàng nhập", href: "/hang-hoa/dat-hang-nhap", icon: "description" },
          { label: "Nhập hàng", href: "/hang-hoa/nhap-hang", icon: "add_box" },
          { label: "Trả hàng nhập", href: "/hang-hoa/tra-hang-nhap", icon: "undo" },
          { label: "Hóa đơn đầu vào", href: "/hang-hoa/hoa-don-dau-vao", icon: "receipt" },
        ],
      },
    ],
  },

  // ============================================================
  // 4. TÀI CHÍNH — sổ quỹ + công nợ (TÁCH KHỎI "Giao dịch")
  // ============================================================
  {
    label: "Tài chính",
    icon: "payments",
    items: [
      { label: "Sổ quỹ", href: "/so-quy", icon: "payments" },
      { label: "Công nợ", href: "/tai-chinh/cong-no", icon: "credit_card" },
    ],
  },

  // ============================================================
  // 5. ĐỐI TÁC — KH + NCC + giao hàng
  // ============================================================
  {
    label: "Đối tác",
    icon: "group",
    subGroups: [
      {
        label: "Khách hàng",
        icon: "person",
        items: [
          { label: "Danh sách KH", href: "/khach-hang", icon: "group" },
          { label: "Nhóm khách hàng", href: "/khach-hang/nhom", icon: "groups" },
        ],
      },
      {
        label: "Nhà cung cấp",
        icon: "apartment",
        items: [
          { label: "Danh sách NCC", href: "/doi-tac/ncc", icon: "apartment" },
          { label: "Đối tác giao hàng", href: "/doi-tac/giao-hang", icon: "local_shipping" },
        ],
      },
    ],
  },

  // ============================================================
  // 6. AI & TỰ ĐỘNG HÓA — gọn lại, bỏ comingSoon clutter
  // ============================================================
  {
    label: "AI & Tự động",
    icon: "auto_awesome",
    items: [
      { label: "AI Agents", href: "/ai-agents", icon: "smart_toy", badge: "New" },
      { label: "KPI Breakdown", href: "/ai-agents/kpi", icon: "trending_up" },
      { label: "Task hàng ngày", href: "/ai-agents/tasks", icon: "checklist" },
      // Các route AI chưa có page (/ai/phan-tich, /ai/import, /ai/chat) →
      // mark comingSoon nhưng KHÔNG render trong sidebar nữa để giảm
      // clutter. Khi page sẵn sàng thì uncomment.
    ],
  },

  // ============================================================
  // 7. HỆ THỐNG — pinned bottom
  // ============================================================
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
 * Collect tất cả href trong sidebar nav để dùng cho "longest match wins"
 * trong isHrefActive. Tính 1 lần khi module load (immutable nav).
 */
const ALL_NAV_HREFS: string[] = (() => {
  const hrefs: string[] = [];
  for (const g of sidebarNavGroups) {
    g.items?.forEach((l) => hrefs.push(l.href));
    g.subGroups?.forEach((sg) => sg.items.forEach((l) => hrefs.push(l.href)));
  }
  return hrefs;
})();

/**
 * Returns true if the current pathname matches the given href.
 *
 * Logic "longest match wins":
 *   - Exact match → always active.
 *   - Prefix match (`pathname.startsWith(href + "/")`) → active CHỈ nếu
 *     không có nav item nào khác có href dài hơn cũng match.
 *
 * Bug từng có: pathname=/hang-hoa/nhom, href=/hang-hoa → prefix match
 * → "Danh sách hàng" cũng active dù user đang ở "Nhóm hàng" (/hang-hoa/nhom).
 * Cả 2 cùng bôi blue → user confused. Fix: chỉ active longest matching href.
 *
 * Special case: href "/" only matches exact "/" để không match mọi pathname.
 */
export function isHrefActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";

  // Exact match always wins
  if (pathname === href) return true;

  // Prefix match — nhưng phải là longest matching href
  if (!pathname.startsWith(href + "/")) return false;

  // Có nav item nào khác (longer) cũng match? Nếu có → ta KHÔNG active.
  return !ALL_NAV_HREFS.some(
    (h) =>
      h !== href &&
      h.length > href.length &&
      (pathname === h || pathname.startsWith(h + "/")),
  );
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
