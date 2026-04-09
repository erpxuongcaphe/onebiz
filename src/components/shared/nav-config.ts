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
// ============================================================

import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  ShoppingCart,
  Package,
  ArrowLeftRight,
  Users,
  Settings,
  Home,
  BarChart3,
  Upload,
  MessageCircle,
  Tags,
  Ruler,
  DollarSign,
  Warehouse,
  History,
  ClipboardCheck,
  CalendarClock,
  Trash2,
  PackageOpen,
  PackagePlus,
  ScrollText,
  Receipt,
  RotateCcw,
  Globe,
  Truck,
  Factory,
  Workflow,
  Boxes,
  Banknote,
  CreditCard,
  Building2,
  UserCog,
  Plug,
  FileClock,
} from "lucide-react";

export type SidebarMode = "admin" | "pos";

export interface SidebarLeaf {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** Disable click + dim style. Combine with `comingSoon` to show "Soon" badge. */
  disabled?: boolean;
  comingSoon?: boolean;
  /** "pos" => opens full-screen POS layout (no sidebar). */
  mode?: SidebarMode;
  /** Optional badge text shown on the right. */
  badge?: string;
}

export interface SidebarSubGroup {
  label: string;
  icon?: LucideIcon;
  items: SidebarLeaf[];
}

export interface SidebarGroup {
  label: string;
  icon: LucideIcon;
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
    icon: Sparkles,
    items: [
      { label: "Trang chủ AI", href: "/", icon: Home },
      { label: "Phân tích kinh doanh", href: "/ai/phan-tich", icon: BarChart3 },
      { label: "Import dữ liệu", href: "/ai/import", icon: Upload },
      {
        label: "Trò chuyện AI",
        href: "/ai/chat",
        icon: MessageCircle,
        disabled: true,
        comingSoon: true,
      },
    ],
  },

  // 2. Bán hàng — REV 2: bỏ POS lẻ, focus B2B + Online
  {
    label: "Bán hàng",
    icon: ShoppingCart,
    items: [
      { label: "POS", href: "/pos", icon: PackagePlus, mode: "pos" },
      { label: "Bán online", href: "/ban-online", icon: Globe },
      { label: "Đơn đặt hàng", href: "/don-hang/dat-hang", icon: ScrollText },
      { label: "Hóa đơn", href: "/don-hang/hoa-don", icon: Receipt },
      { label: "Trả hàng", href: "/don-hang/tra-hang", icon: RotateCcw },
    ],
  },

  // 3. Hàng hóa
  {
    label: "Hàng hóa",
    icon: Package,
    subGroups: [
      {
        label: "Sản phẩm",
        icon: Boxes,
        items: [
          { label: "Danh sách hàng", href: "/hang-hoa", icon: Package },
          { label: "Nhóm hàng", href: "/hang-hoa/nhom", icon: Tags },
          { label: "Đơn vị tính", href: "/hang-hoa/don-vi-tinh", icon: Ruler },
          { label: "Bảng giá", href: "/hang-hoa/thiet-lap-gia", icon: DollarSign },
        ],
      },
      {
        label: "Kho",
        icon: Warehouse,
        items: [
          { label: "Tồn kho", href: "/hang-hoa/ton-kho", icon: Warehouse },
          { label: "Lịch sử kho", href: "/hang-hoa/lich-su-kho", icon: History },
          { label: "Kiểm kho", href: "/hang-hoa/kiem-kho", icon: ClipboardCheck },
          { label: "Hạn sử dụng (HSD)", href: "/hang-hoa/hsd", icon: CalendarClock },
          { label: "Xuất hủy", href: "/hang-hoa/xuat-huy", icon: Trash2 },
          { label: "Xuất dùng nội bộ", href: "/hang-hoa/xuat-dung-noi-bo", icon: PackageOpen },
          { label: "Chuyển kho", href: "/hang-hoa/chuyen-kho", icon: ArrowLeftRight },
        ],
      },
      {
        label: "Sản xuất",
        icon: Factory,
        items: [
          { label: "Lệnh sản xuất", href: "/hang-hoa/san-xuat", icon: Factory },
          { label: "Công thức (BOM)", href: "/hang-hoa/cong-thuc", icon: Workflow },
          { label: "Lô sản xuất", href: "/hang-hoa/lo-san-xuat", icon: Boxes },
        ],
      },
    ],
  },

  // 4. Giao dịch
  {
    label: "Giao dịch",
    icon: ArrowLeftRight,
    subGroups: [
      {
        label: "Mua hàng",
        icon: PackagePlus,
        items: [
          { label: "Đặt hàng nhập", href: "/hang-hoa/dat-hang-nhap", icon: ScrollText },
          { label: "Nhập hàng", href: "/hang-hoa/nhap-hang", icon: PackagePlus },
          { label: "Trả hàng nhập", href: "/hang-hoa/tra-hang-nhap", icon: RotateCcw },
        ],
      },
      {
        label: "Vận chuyển",
        icon: Truck,
        items: [
          { label: "Vận đơn", href: "/don-hang/van-don", icon: Truck },
        ],
      },
      {
        label: "Tài chính",
        icon: Banknote,
        items: [
          { label: "Sổ quỹ", href: "/so-quy", icon: Banknote },
          { label: "Công nợ", href: "/tai-chinh/cong-no", icon: CreditCard },
        ],
      },
    ],
  },

  // 5. Đối tác
  {
    label: "Đối tác",
    icon: Users,
    items: [
      { label: "Khách hàng", href: "/khach-hang", icon: Users },
      { label: "Nhóm khách hàng", href: "/khach-hang/nhom", icon: Tags },
      { label: "Nhà cung cấp", href: "/doi-tac/ncc", icon: Building2 },
      { label: "Đối tác giao hàng", href: "/doi-tac/giao-hang", icon: Truck },
    ],
  },

  // 6. Hệ thống — pinned bottom
  {
    label: "Hệ thống",
    icon: Settings,
    pinBottom: true,
    items: [
      { label: "Người dùng & phân quyền", href: "/he-thong/users", icon: UserCog },
      { label: "Chi nhánh", href: "/he-thong/chi-nhanh", icon: Building2 },
      { label: "Thiết lập chung", href: "/he-thong/thiet-lap", icon: Settings },
      { label: "Tích hợp", href: "/he-thong/tich-hop", icon: Plug },
      { label: "Lịch sử thao tác", href: "/he-thong/audit", icon: FileClock },
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
