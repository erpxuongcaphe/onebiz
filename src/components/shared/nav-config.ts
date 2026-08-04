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
          { label: "Công thức sản xuất (BOM)", href: "/hang-hoa/cong-thuc" },
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
          // CEO 03/06/2026 — Sprint 3 (audit menu P0): hợp nhất route trùng,
          // dùng /doi-tac/giao-hang (sidebar V2 canonical) thay vì legacy URL.
          { label: "Đối tác giao hàng", href: "/doi-tac/giao-hang" },
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
    // CEO 22/05/2026 (UX P1 #3): chốt tên "Báo cáo" cho menu top-nav để
    // đồng nhất với sidebar drawer (line 305) + app-switcher + mobile nav.
    // Trước đây top-nav nói "Phân tích" còn các nơi khác nói "Báo cáo" →
    // user confuse.
    label: "Báo cáo",
    href: "/phan-tich/trung-tam",
  },
  // Day 4 16/05/2026: ẩn "Bán online" — chưa có data thật, đang là mock 15 đơn.
  // Bật lại khi đã wire vào shopee/lazada/tiki API hoặc có nguồn đơn online thật.
  // {
  //   label: "Bán online",
  //   href: "/ban-online",
  // },
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
  /** Only highlight this leaf when pathname exactly equals href. */
  exact?: boolean;
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
  /** Any one of these permission codes grants access. */
  permissions?: string[];
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

/**
 * Một mục menu có được hiện cho người đang đăng nhập không.
 *
 * Luật (giữ nguyên cách `flattenGroup` của mobile-bottom-nav đang chạy):
 * mục không khai quyền thì ai cũng thấy; có khai thì chỉ cần khớp MỘT mã.
 *
 * 04/08/2026 — tách ra dùng chung vì trước đây luật này chỉ nằm trong
 * mobile-bottom-nav, còn menu hamburger (top-nav) render thẳng không lọc →
 * thu ngân mở menu thấy cả Hệ thống/Sản xuất, bấm vào báo "không có quyền".
 */
export function canSeeNavLeaf(
  leaf: Pick<SidebarLeaf, "permission" | "permissions">,
  hasPermission: (code: string) => boolean,
): boolean {
  const codes = leaf.permissions ?? (leaf.permission ? [leaf.permission] : []);
  return codes.length === 0 || codes.some(hasPermission);
}

export const sidebarNavGroups: SidebarGroup[] = [
  // ============================================================
  // 1. TỔNG QUAN — chỉ Dashboard + Cảnh báo (Phân tích + Báo cáo TC tách
  // sang group BÁO CÁO riêng dưới cùng theo CEO 04/05/2026)
  // ============================================================
  {
    label: "Tổng quan",
    icon: "dashboard",
    items: [
      { label: "Trang chủ", href: "/", icon: "home" },
      { label: "Cảnh báo", href: "/phan-tich/canh-bao", icon: "warning" },
    ],
  },

  // ============================================================
  // 2. BÁN HÀNG — sales documents (POS tách lên top-nav header)
  // CEO 04/05/2026: Hoá đơn lên TOP (kế toán xem nhiều nhất hàng ngày).
  // POS Bán lẻ + POS F&B + KDS rời sidebar → top-nav dropdown "POS"
  // (front-of-house cashier không cần admin sidebar).
  // ============================================================
  {
    label: "Bán hàng",
    icon: "shopping_cart",
    items: [
      { label: "Hóa đơn", href: "/don-hang/hoa-don", icon: "receipt_long" },
      // CEO 03/06/2026 — Sprint 3 (audit menu P0): Bán nội bộ là intercompany
      // invoice (subtotal + tax + total), bản chất Sale chứ không phải Stock
      // movement. SAP/Odoo/Misa đều xếp ở module Sales. Kế toán hợp nhất P&L
      // chuỗi cần ở chung group Hoá đơn. Đổi tên "Bán nội bộ chuỗi" để CEO
      // phân biệt rõ với "Chuyển kho" (movement) + "Xuất dùng nội bộ" (chi phí).
      { label: "Bán nội bộ chuỗi", href: "/hang-hoa/ban-noi-bo", icon: "store" },
      { label: "Đơn đặt hàng", href: "/don-hang/dat-hang", icon: "description" },
      { label: "Trả hàng", href: "/don-hang/tra-hang", icon: "undo" },
      { label: "Vận đơn", href: "/don-hang/van-don", icon: "local_shipping" },
      // Day 4 16/05/2026: ẩn "Bán online" — mock data, bật lại khi có nguồn thật
      // { label: "Bán online", href: "/ban-online", icon: "public" },
    ],
  },

  // ============================================================
  // 3. KHO — flat 7 items, sort theo frequency (daily → rare)
  // CEO 03/06/2026 (refined): không chia subGroup vì 7 items ≤ 8 vẫn fit
  // 1 list. SubGroup làm tăng click expand không cần thiết.
  // NOTE: "Bán nội bộ" đã chuyển sang group "Bán hàng" (intercompany invoice).
  // ============================================================
  {
    label: "Kho",
    icon: "warehouse",
    items: [
      // ── Daily (thủ kho dùng hằng ngày) ──
      { label: "Tồn kho", href: "/hang-hoa/ton-kho", icon: "warehouse" },
      { label: "Lịch sử kho", href: "/hang-hoa/lich-su-kho", icon: "history" },
      // ── Weekly ──
      { label: "Kiểm kho", href: "/hang-hoa/kiem-kho", icon: "fact_check" },
      { label: "Hạn sử dụng", href: "/hang-hoa/hsd", icon: "event_note" },
      { label: "Chuyển kho", href: "/hang-hoa/chuyen-kho", icon: "swap_horiz" },
      // ── Occasionally / Rare ──
      { label: "Xuất dùng nội bộ", href: "/hang-hoa/xuat-dung-noi-bo", icon: "inventory" },
      { label: "Xuất hủy", href: "/hang-hoa/xuat-huy", icon: "delete" },
    ],
  },

  // ============================================================
  // 4. MUA HÀNG — tách top-level từ "Hàng hoá > Mua hàng" cũ
  // ============================================================
  {
    label: "Mua hàng",
    icon: "add_box",
    items: [
      // Day 7 16/05/2026: Mua hàng — quản lý + admin xem; cashier không cần
      // CEO 14/07: Dự kiến mua hàng (MRP) — từ đơn đặt hàng nổ BOM ra NVL cần mua.
      { label: "Dự kiến mua hàng", href: "/mua-hang/du-kien-mua-hang", icon: "insights", permission: "inventory.create_po" },
      { label: "Đặt hàng nhập", href: "/hang-hoa/dat-hang-nhap", icon: "description", permission: "inventory.create_po" },
      { label: "Nhập hàng", href: "/hang-hoa/nhap-hang", icon: "add_box", permission: "inventory.create_po" },
      { label: "Trả hàng nhập", href: "/hang-hoa/tra-hang-nhap", icon: "undo", permission: "inventory.create_po" },
      { label: "Hóa đơn đầu vào", href: "/hang-hoa/hoa-don-dau-vao", icon: "receipt", permission: "inventory.create_po" },
    ],
  },

  // ============================================================
  // 5. SẢN XUẤT — tách top-level từ "Hàng hoá > Sản xuất" cũ
  // ============================================================
  {
    label: "Sản xuất",
    icon: "factory",
    items: [
      // Day 7 16/05/2026: SX là module xưởng rang — cashier không cần thấy
      // CEO 25/05/2026: tách permission khỏi inventory.view → production.* riêng
      // để admin có thể grant/revoke quyền SX độc lập với quyền kho.
      { label: "Dashboard Sản xuất", href: "/san-xuat", icon: "bar_chart", permission: "production.view" },
      { label: "Lệnh sản xuất", href: "/hang-hoa/san-xuat", icon: "factory", permission: "production.view" },
      { label: "Công thức sản xuất (BOM)", href: "/hang-hoa/cong-thuc", icon: "schema", permission: "production.manage_bom" },
      { label: "Lô sản xuất", href: "/hang-hoa/lo-san-xuat", icon: "inventory_2", permission: "production.view" },
    ],
  },

  // ============================================================
  // 6. DANH MỤC — gộp master data (sản phẩm + KH + NCC) một chỗ
  // CEO 04/05: trước đây scatter 3 group khác nhau → khó tìm.
  // ============================================================
  {
    label: "Danh mục",
    icon: "category",
    subGroups: [
      {
        label: "Sản phẩm",
        icon: "inventory_2",
        items: [
          { label: "Danh sách sản phẩm", href: "/hang-hoa", icon: "inventory_2" },
          { label: "Nhóm hàng", href: "/hang-hoa/nhom", icon: "sell" },
          { label: "Tuỳ chọn món FnB", href: "/hang-hoa/tuy-chon-fnb", icon: "tune" },
          { label: "Đơn vị tính", href: "/hang-hoa/don-vi-tinh", icon: "straighten" },
          { label: "Bảng giá", href: "/hang-hoa/thiet-lap-gia", icon: "attach_money" },
        ],
      },
      {
        label: "Khách hàng",
        icon: "person",
        items: [
          { label: "Danh sách khách hàng", href: "/khach-hang", icon: "group" },
          { label: "Nhóm khách hàng", href: "/khach-hang/nhom", icon: "groups" },
        ],
      },
      {
        label: "Nhà cung cấp",
        icon: "apartment",
        items: [
          { label: "Danh sách nhà cung cấp", href: "/doi-tac/ncc", icon: "apartment" },
          { label: "Đối tác giao hàng", href: "/doi-tac/giao-hang", icon: "local_shipping" },
        ],
      },
    ],
  },

  // ============================================================
  // 7. TÀI CHÍNH — gộp tất cả nghiệp vụ tài chính 1 chỗ
  // CEO 03/06/2026 — chia 2 subGroup theo "Action" vs "Report" để clearer
  // mental model: kế toán biết ngay "tạo phiếu" vs "đọc báo cáo".
  // Nguyên tắc: trang sinh giao dịch tài chính ở "Sổ sách & thu chi",
  // trang đọc số ở "Báo cáo tài chính".
  // ============================================================
  {
    label: "Tài chính",
    icon: "payments",
    subGroups: [
      {
        label: "Sổ sách & thu chi",
        icon: "payments",
        items: [
          { label: "Sổ quỹ", href: "/so-quy", icon: "payments", permission: "finance.view_cash_book" },
          { label: "Công nợ", href: "/tai-chinh/cong-no", icon: "credit_card", permission: "customers.view_debt" },
        ],
      },
      {
        label: "Báo cáo tài chính",
        icon: "analytics",
        items: [
          { label: "Phân tích tài chính", href: "/phan-tich/tai-chinh", icon: "account_balance" },
          { label: "Kết quả vận hành", href: "/phan-tich/bao-cao-tai-chinh", icon: "monitoring" },
          { label: "Lưu chuyển tiền tệ", href: "/phan-tich/luong-tien", icon: "payments" },
          { label: "Tuổi nợ phải thu, phải trả", href: "/phan-tich/cong-no-aging", icon: "credit_card_off", badge: "Mới" },
          { label: "VAT đầu vào / ra", href: "/phan-tich/vat", icon: "receipt", badge: "Mới" },
        ],
      },
    ],
  },

  // ============================================================
  // 7b. KHUYẾN MÃI & MARKETING — CEO 03/06/2026 (audit menu P1)
  // Chuỗi cà phê chạy promo theo quán/theo mùa thường xuyên. Trước đây các
  // trang khuyến mãi nằm ẩn trong /cai-dat → CEO không tìm thấy.
  // KiotViet + Sapo + MISA đều có group riêng cho Marketing.
  // ============================================================
  {
    label: "Khuyến mãi",
    icon: "local_offer",
    items: [
      { label: "MKT Hub", href: "/mkt", icon: "campaign", permission: "mkt.view" },
      { label: "Chương trình khuyến mãi", href: "/cai-dat/khuyen-mai", icon: "local_offer" },
      { label: "Mã giảm giá", href: "/cai-dat/ma-giam-gia", icon: "qr_code_2" },
      { label: "Báo cáo khuyến mãi", href: "/phan-tich/khuyen-mai", icon: "trending_up" },
    ],
  },

  // ============================================================
  // 8. AI & TỰ ĐỘNG
  // ============================================================
  {
    label: "AI & Tự động",
    icon: "auto_awesome",
    items: [
      { label: "AI Agents", href: "/ai-agents", icon: "smart_toy", badge: "New" },
      { label: "KPI Breakdown", href: "/ai-agents/kpi", icon: "trending_up" },
      { label: "Task hàng ngày", href: "/ai-agents/tasks", icon: "checklist" },
    ],
  },

  // ============================================================
  // 9. BÁO CÁO — lối vào gọn; toàn bộ danh mục nằm trong Trung tâm báo cáo.
  // ============================================================
  {
    label: "Báo cáo",
    icon: "analytics",
    items: [
      {
        label: "Trung tâm báo cáo",
        href: "/phan-tich/trung-tam",
        icon: "analytics",
        permissions: ["reports.dashboard", "reports.analytics", "reports.fnb"],
      },
      {
        label: "Tổng quan kinh doanh",
        href: "/phan-tich",
        icon: "insights",
        permission: "reports.dashboard",
        exact: true,
      },
      {
        label: "Báo cáo cuối ngày",
        href: "/phan-tich/cuoi-ngay",
        icon: "today",
        permission: "reports.dashboard",
      },
      {
        label: "Cảnh báo điều hành",
        href: "/phan-tich/canh-bao",
        icon: "warning",
        permission: "reports.dashboard",
      },
    ],
  },
  // ============================================================
  // 10. HỆ THỐNG — pinned bottom
  // ============================================================
  {
    label: "Hệ thống",
    icon: "settings",
    pinBottom: true,
    items: [
      // Day 7 16/05/2026: gắn permission cho các route nhạy cảm Hệ thống
      { label: "Cấp OTP duyệt từ xa", href: "/cap-otp", icon: "vpn_key", permission: "system.issue_otp" },
      { label: "Người dùng & phân quyền", href: "/he-thong/users", icon: "manage_accounts", permission: "system.manage_users" },
      { label: "Chi nhánh", href: "/he-thong/chi-nhanh", icon: "apartment", permission: "system.manage_branches" },
      { label: "Bàn & Khu vực F&B", href: "/he-thong/quan-ly-ban", icon: "chair", permission: "system.manage_branches" },
      { label: "Sơ đồ bàn", href: "/he-thong/so-do-ban", icon: "map", permission: "floor_plan.view" },
      { label: "Thiết lập chung", href: "/he-thong/thiet-lap", icon: "settings", permission: "system.manage_roles" },
      { label: "Tích hợp", href: "/he-thong/tich-hop", icon: "power", comingSoon: true, permission: "system.manage_roles" },
      {
        label: "Ca chờ đối chiếu",
        href: "/he-thong/ca-cho-doi-soat",
        icon: "schedule",
        permissions: ["shifts.reconcile_any", "shifts.reconcile_own_branch"],
      },
      { label: "Lịch sử thao tác", href: "/he-thong/audit", icon: "pending_actions", permission: "system.view_audit" },
      { label: "Toàn vẹn kho", href: "/he-thong/toan-ven-kho", icon: "fact_check", permission: "system.view_audit" },
      { label: "Kiểm tra dữ liệu POS", href: "/he-thong/toan-ven-pos", icon: "point_of_sale", permission: "system.view_audit" },
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
export function isHrefActive(
  pathname: string,
  href: string,
  exact = false,
): boolean {
  if (href === "/") return pathname === "/";

  if (exact) return pathname === href;

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
