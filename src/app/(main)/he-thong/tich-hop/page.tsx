import { Plug, Webhook, Cloud, Zap } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Tích hợp — OneBiz ERP",
};

export default function TichHopPlaceholderPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-xl w-full bg-white rounded-xl border shadow-sm p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-lg bg-emerald-100 flex items-center justify-center">
            <Plug className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Tích hợp</h1>
            <p className="text-sm text-muted-foreground">Đang hoàn thiện — sẽ ra mắt sớm</p>
          </div>
        </div>

        <p className="text-sm text-foreground/80 mb-5">
          Trung tâm kết nối với các nền tảng bên thứ ba: sàn TMĐT, social commerce,
          cổng thanh toán, đơn vị vận chuyển, kế toán và webhook tuỳ chỉnh.
        </p>

        <div className="space-y-2 mb-6">
          <div className="flex items-start gap-3 text-sm">
            <Cloud className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="font-medium">Sàn & social commerce</div>
              <div className="text-xs text-muted-foreground">Shopee, Lazada, TikTok Shop, Facebook, Zalo OA</div>
            </div>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <Zap className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="font-medium">Thanh toán & vận chuyển</div>
              <div className="text-xs text-muted-foreground">VNPay, Momo, ZaloPay · GHN, GHTK, J&T, Viettel Post</div>
            </div>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <Webhook className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <div className="font-medium">Webhook & API</div>
              <div className="text-xs text-muted-foreground">Tự động đồng bộ đơn hàng, sản phẩm, tồn kho qua REST API</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t">
          <span className="text-xs text-muted-foreground">Hiện tại bạn có thể dùng tạm:</span>
          <Link
            href="/cai-dat/ket-noi"
            className="text-xs font-medium text-emerald-600 hover:underline"
          >
            Cài đặt → Kết nối
          </Link>
        </div>
      </div>
    </div>
  );
}
