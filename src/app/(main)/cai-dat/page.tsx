"use client";

/**
 * Trang Cài đặt — mục lục (hub).
 *
 * CEO 05/06/2026: bỏ form "Thông tin cửa hàng" trùng với /he-thong/thiet-lap
 * (form cũ chỉ lưu localStorage, không đồng bộ giữa máy). Trang này giờ là
 * MENU mục lục các cài đặt con — giúp anh nhìn 1 phát thấy hết.
 */

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface SettingItem {
  href: string;
  icon: string;
  label: string;
  desc: string;
  highlight?: boolean; // Mục quan trọng — đánh dấu nổi bật
  external?: boolean;  // Link sang module khác (ngoài /cai-dat)
}

interface SettingGroup {
  title: string;
  items: SettingItem[];
}

const GROUPS: SettingGroup[] = [
  {
    title: "Doanh nghiệp",
    items: [
      {
        href: "/he-thong/thiet-lap",
        icon: "business",
        label: "Thông tin doanh nghiệp",
        desc: "Tên DN, MST, địa chỉ, logo. Lưu vào CSDL — đồng bộ mọi máy.",
        highlight: true,
        external: true,
      },
      {
        href: "/he-thong/chi-nhanh",
        icon: "apartment",
        label: "Chi nhánh",
        desc: "Quản lý chi nhánh và pháp nhân, cấu hình kho — quán.",
        external: true,
      },
    ],
  },
  {
    title: "Bán hàng & Hoá đơn",
    items: [
      { href: "/cai-dat/ban-hang", icon: "point_of_sale", label: "Cấu hình bán hàng", desc: "POS, quy tắc bán, làm tròn giá." },
      { href: "/cai-dat/hoa-don", icon: "receipt_long", label: "Mẫu hoá đơn", desc: "Kiểu in, khổ giấy, footer cảm ơn." },
      { href: "/cai-dat/thanh-toan", icon: "payments", label: "Phương thức thanh toán", desc: "Tiền mặt, chuyển khoản, ví điện tử." },
      { href: "/cai-dat/bang-gia", icon: "sell", label: "Bảng giá", desc: "Bảng giá nhiều cấp + theo nền tảng (Shopee/Grab)." },
    ],
  },
  {
    title: "Khuyến mãi & Khách hàng",
    items: [
      { href: "/cai-dat/khuyen-mai", icon: "campaign", label: "Khuyến mãi", desc: "Combo, giảm giá theo đơn / sản phẩm." },
      { href: "/cai-dat/ma-giam-gia", icon: "confirmation_number", label: "Mã giảm giá (coupon)", desc: "Mã 1 lần / nhiều lần, hết hạn." },
      { href: "/cai-dat/tich-diem", icon: "loyalty", label: "Tích điểm thành viên", desc: "Quy đổi 1 điểm = ? đồng, hạng thẻ." },
    ],
  },
  {
    title: "Kho & Giao hàng",
    items: [
      { href: "/cai-dat/kho-hang", icon: "warehouse", label: "Cấu hình kho", desc: "Quy tắc trừ kho, kiểm kê, cảnh báo hết hàng." },
      { href: "/cai-dat/giao-hang", icon: "local_shipping", label: "Đối tác giao hàng", desc: "GHN, GHTK, Ahamove, J&T..." },
      { href: "/cai-dat/phi-giao-hang", icon: "route", label: "Phí giao hàng", desc: "Tính theo km bậc thang cho FnB." },
    ],
  },
  {
    title: "FnB & Sơ đồ bàn",
    items: [
      { href: "/cai-dat/fnb-presets", icon: "restaurant_menu", label: "Bộ tuỳ chọn FnB", desc: "Preset mức đường, đá, topping cho menu pha chế." },
      {
        href: "/he-thong/so-do-ban",
        icon: "map",
        label: "Sơ đồ bàn",
        desc: "Vẽ sơ đồ kéo thả — đa tầng, đa khu vực.",
        external: true,
      },
    ],
  },
  {
    title: "Thiết bị & Phụ trợ",
    items: [
      { href: "/cai-dat/thiet-bi-pos", icon: "print", label: "Thiết bị POS", desc: "Máy in bill, KDS, ngăn kéo tiền, máy quét mã." },
      { href: "/cai-dat/ket-noi", icon: "link", label: "Kết nối API", desc: "Hoá đơn điện tử, ngân hàng, đối tác bên ngoài." },
      { href: "/cai-dat/thong-bao", icon: "notifications", label: "Thông báo", desc: "Email + đẩy thông báo các sự kiện." },
    ],
  },
  {
    title: "Người dùng & Giao diện",
    items: [
      {
        href: "/he-thong/users",
        icon: "manage_accounts",
        label: "Người dùng",
        desc: "Thêm, sửa, gán vai trò cho nhân viên.",
        external: true,
      },
      { href: "/cai-dat/phan-quyen", icon: "verified_user", label: "Vai trò & quyền", desc: "Định nghĩa vai trò + danh sách quyền cụ thể." },
      { href: "/cai-dat/giao-dien", icon: "palette", label: "Giao diện", desc: "Sáng / Tối, màu thương hiệu, font." },
      { href: "/cai-dat/ngon-ngu", icon: "language", label: "Ngôn ngữ", desc: "Tiếng Việt / Tiếng Anh." },
    ],
  },
];

export default function CaiDatHubPage() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Icon name="settings" size={26} className="text-primary" />
          Cài đặt
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mục lục các cài đặt của hệ thống. Chọn mục để vào trang chi tiết.
        </p>
      </header>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-2.5">
          <h2 className="text-xs uppercase font-semibold text-muted-foreground tracking-wide">
            {group.title}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  "group flex items-start gap-3 p-4 rounded-lg border bg-card",
                  "hover:border-primary hover:shadow-sm transition-all",
                  it.highlight && "border-primary/40 bg-primary/[0.02]",
                )}
              >
                <div
                  className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                    it.highlight
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary-fixed text-primary",
                  )}
                >
                  <Icon name={it.icon} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm truncate">{it.label}</p>
                    {it.external && (
                      <Icon
                        name="north_east"
                        size={12}
                        className="text-muted-foreground shrink-0"
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {it.desc}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <p className="text-xs text-muted-foreground text-center pt-4 pb-2">
        Mục có mũi tên ↗ là nhảy sang module khác. Mục có viền xanh đậm là quan
        trọng nhất nên làm trước.
      </p>
    </div>
  );
}
