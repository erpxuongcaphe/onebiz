"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/components/ui/icon";
import { useAuth, useToast } from "@/lib/contexts";
import {
  useDeviceBinding,
  writeDeviceBinding,
  clearDeviceBinding,
} from "@/lib/hooks/use-device-binding";

/**
 * Cài đặt khoá thiết bị POS (device binding).
 *
 * Flow:
 *   1. Owner/admin đăng nhập vào tablet → mở page này.
 *   2. Chọn chi nhánh + đặt tên thiết bị → bấm "Khoá thiết bị".
 *   3. Reload → auth-context force currentBranch = branch đã bind,
 *      PosBranchSelector hiển thị badge khoá thay vì dropdown.
 *   4. Admin đăng xuất → staff đăng nhập lại, tablet vẫn khoá.
 *
 * Lưu ý:
 *   - localStorage per-browser, per-device. Xoá cache → binding bay.
 *   - Chỉ owner mới truy cập được page này (staff thấy "Không có quyền").
 *   - Nếu branch đã bind bị xoá khỏi DB → auth-context tự fallback, không crash.
 */
export default function DeviceBindingSettingsPage() {
  const { user, branches } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const binding = useDeviceBinding();

  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [deviceName, setDeviceName] = useState<string>("");

  // Prefill khi page load: nếu đã bind → show current.
  useEffect(() => {
    if (binding) {
      setSelectedBranchId(binding.branchId);
      setDeviceName(binding.deviceName);
    } else if (branches.length > 0) {
      setSelectedBranchId(branches[0].id);
    }
  }, [binding, branches]);

  // Owner-only gate. Staff thấy trang "không có quyền" thay vì form.
  if (user && user.role !== "owner") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Khoá thiết bị POS</h1>
        </div>
        <Card>
          <CardContent className="py-8 flex flex-col items-center text-center gap-3">
            <Icon name="lock" size={40} className="text-muted-foreground opacity-40" />
            <div>
              <p className="text-sm font-medium">Chỉ chủ cửa hàng mới truy cập được</p>
              <p className="text-xs text-muted-foreground mt-1">
                Bạn cần quyền <strong>owner</strong> để khoá/mở khoá thiết bị. Liên hệ chủ
                cửa hàng để được hỗ trợ.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleBind = () => {
    const branch = branches.find((b) => b.id === selectedBranchId);
    if (!branch) {
      toast({
        title: "Chi nhánh không hợp lệ",
        description: "Vui lòng chọn chi nhánh trong danh sách.",
        variant: "error",
      });
      return;
    }
    if (!deviceName.trim()) {
      toast({
        title: "Thiếu tên thiết bị",
        description: "Đặt tên giúp anh/chị phân biệt nhiều tablet sau này (vd \"iPad quán Nguyễn Trãi\").",
        variant: "error",
      });
      return;
    }
    writeDeviceBinding({
      branchId: selectedBranchId,
      deviceName: deviceName.trim(),
    });
    toast({
      title: "Đã khoá thiết bị",
      description: `Tablet này khoá vào chi nhánh "${branch.name}". Đăng xuất + đăng nhập lại để xác nhận.`,
      variant: "success",
    });
    // Force reload để auth-context pick up binding và re-select currentBranch.
    router.refresh();
  };

  const handleUnbind = () => {
    clearDeviceBinding();
    toast({
      title: "Đã mở khoá thiết bị",
      description: "Tablet trở lại chế độ chọn chi nhánh tự do.",
      variant: "info",
    });
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Khoá thiết bị POS</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Khoá tablet này vào 1 chi nhánh cố định — staff không đổi chi nhánh được, tránh lỡ
          tay ghi doanh thu sai quán.
        </p>
      </div>

      {/* Trạng thái hiện tại */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon name="devices" size={18} />
            Trạng thái thiết bị
          </CardTitle>
        </CardHeader>
        <CardContent>
          {binding ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <Icon name="lock" size={20} className="text-primary mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">
                    Đang khoá — {binding.deviceName}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Chi nhánh:{" "}
                    <strong>
                      {branches.find((b) => b.id === binding.branchId)?.name ??
                        "(Chi nhánh đã bị xoá)"}
                    </strong>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Đã khoá từ: {new Date(binding.boundAt).toLocaleString("vi-VN")}
                  </div>
                </div>
              </div>
              <Button variant="outline" onClick={handleUnbind} className="self-start">
                <Icon name="lock_open" size={16} className="mr-1.5" />
                Mở khoá thiết bị
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-container p-3">
              <Icon name="lock_open" size={20} className="text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold">Chưa khoá</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Staff trên tablet này đang có thể đổi chi nhánh tự do qua dropdown. Khoá lại
                  bên dưới để bảo vệ doanh thu ca làm việc.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form khoá / đổi binding */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {binding ? "Đổi chi nhánh khoá" : "Khoá vào chi nhánh"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Chi nhánh khoá</label>
              <Select
                value={selectedBranchId}
                onValueChange={(v) => setSelectedBranchId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn chi nhánh" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code ? `${b.code} · ${b.name}` : b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tên thiết bị</label>
              <Input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="Vd: iPad quán Nguyễn Trãi"
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">
                Giúp anh/chị phân biệt nhiều tablet trong chuỗi.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleBind}>
              <Icon name="lock" size={16} className="mr-1.5" />
              {binding ? "Cập nhật khoá" : "Khoá thiết bị"}
            </Button>
            {binding && (
              <Button variant="ghost" onClick={handleUnbind}>
                Huỷ
              </Button>
            )}
          </div>

          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground space-y-1">
            <p>
              <strong>Lưu ý:</strong> khoá lưu trên <em>trình duyệt thiết bị này</em>. Nếu xoá
              cache / mở chế độ ẩn danh / dùng trình duyệt khác → khoá bị huỷ, cần bind lại.
            </p>
            <p>
              Staff không thấy được trang này (chỉ chủ cửa hàng mới truy cập). Sau khi khoá,
              đăng xuất và để staff đăng nhập như bình thường.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
