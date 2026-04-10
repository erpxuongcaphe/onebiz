import { UserCog, Shield, KeyRound, Users2 } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Người dùng & Phân quyền — OneBiz ERP",
};

export default function UsersPlaceholderPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-xl w-full bg-white rounded-xl border shadow-sm p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-lg bg-violet-100 flex items-center justify-center">
            <UserCog className="h-6 w-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Người dùng & Phân quyền</h1>
            <p className="text-sm text-muted-foreground">Đang hoàn thiện — sẽ ra mắt sớm</p>
          </div>
        </div>

        <p className="text-sm text-foreground/80 mb-5">
          Trang quản lý tài khoản nhân viên, vai trò và phân quyền truy cập từng phân hệ.
          Tính năng đang được xây dựng trên nền RLS Supabase đã sẵn sàng.
        </p>

        <div className="space-y-2 mb-6">
          <div className="flex items-start gap-3 text-sm">
            <Users2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="font-medium">Quản lý người dùng</div>
              <div className="text-xs text-muted-foreground">Mời nhân viên, gán chi nhánh, vô hiệu hoá tài khoản</div>
            </div>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <Shield className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="font-medium">Vai trò (Roles)</div>
              <div className="text-xs text-muted-foreground">Admin, Quản lý, Nhân viên bán, Kế toán, Thủ kho — preset có sẵn + tự custom</div>
            </div>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <KeyRound className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="font-medium">Phân quyền chi tiết</div>
              <div className="text-xs text-muted-foreground">Bật/tắt từng module + thao tác (xem, tạo, sửa, xoá, duyệt)</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t">
          <span className="text-xs text-muted-foreground">Hiện tại bạn có thể dùng tạm:</span>
          <Link
            href="/cai-dat/phan-quyen"
            className="text-xs font-medium text-violet-600 hover:text-violet-700 hover:underline"
          >
            Cài đặt → Phân quyền
          </Link>
        </div>
      </div>
    </div>
  );
}
