import { Settings, Building, FileText, Globe, Bell } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Thiết lập chung — OneBiz ERP",
};

export default function ThietLapPlaceholderPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-xl w-full bg-white rounded-xl border shadow-sm p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
            <Settings className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Thiết lập chung</h1>
            <p className="text-sm text-muted-foreground">Đang hoàn thiện — sẽ ra mắt sớm</p>
          </div>
        </div>

        <p className="text-sm text-foreground/80 mb-5">
          Trang tổng hợp toàn bộ thiết lập hệ thống cho doanh nghiệp: thông tin công ty,
          định dạng số liệu, ngôn ngữ, múi giờ và các tuỳ chỉnh chung.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { icon: Building, label: "Thông tin doanh nghiệp", desc: "Tên, MST, địa chỉ, logo" },
            { icon: FileText, label: "Định dạng tài liệu", desc: "Số, tiền tệ, ngày giờ" },
            { icon: Globe, label: "Ngôn ngữ & múi giờ", desc: "Vietnamese, GMT+7" },
            { icon: Bell, label: "Thông báo hệ thống", desc: "Email, in-app alerts" },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-2 p-3 rounded-md bg-muted/40 border">
              <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs font-medium">{label}</div>
                <div className="text-[11px] text-muted-foreground">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-4 border-t">
          <span className="text-xs text-muted-foreground">Tạm thời dùng:</span>
          <Link href="/cai-dat" className="text-xs font-medium text-blue-600 hover:underline">
            Cài đặt
          </Link>
          <span className="text-xs text-muted-foreground">·</span>
          <Link href="/cai-dat/ngon-ngu" className="text-xs font-medium text-blue-600 hover:underline">
            Ngôn ngữ
          </Link>
          <span className="text-xs text-muted-foreground">·</span>
          <Link href="/cai-dat/giao-dien" className="text-xs font-medium text-blue-600 hover:underline">
            Giao diện
          </Link>
        </div>
      </div>
    </div>
  );
}
