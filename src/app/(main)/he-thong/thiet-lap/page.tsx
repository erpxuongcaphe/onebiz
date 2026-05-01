"use client";

/**
 * Thiết lập chung — Thông tin doanh nghiệp (HT-2).
 *
 * Trước đây là placeholder vỏ rỗng → in hóa đơn không có MST/địa chỉ
 * pháp lý → vi phạm quy định kế toán + UX nghèo (CEO không tự sửa được).
 *
 * Trang này wire vào `tenants.settings.business_info` jsonb (không cần
 * migration mới). Schema chứa: businessName, taxCode, address, phone,
 * email, website, logoUrl, bankAccount, bankName, invoiceFooter.
 */

import { useEffect, useState } from "react";
import { useToast } from "@/lib/contexts";
import {
  getTenantBusinessInfo,
  updateTenantBusinessInfo,
  type TenantBusinessInfo,
} from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/ui/icon";

export default function ThietLapPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TenantBusinessInfo>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTenantBusinessInfo()
      .then((info) => {
        if (!cancelled) setForm(info);
      })
      .catch(() => {
        if (!cancelled) setForm({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof TenantBusinessInfo>(
    key: K,
    value: TenantBusinessInfo[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateTenantBusinessInfo(form);
      setForm(updated);
      toast({
        title: "Đã lưu thông tin doanh nghiệp",
        description: "Hóa đơn mới sẽ dùng thông tin vừa cập nhật.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi lưu thông tin",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-border bg-surface-container-lowest px-4 lg:px-6 py-4">
        <h1 className="text-lg font-semibold">Thiết lập chung</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Thông tin doanh nghiệp xuất hiện trên hóa đơn, biên lai POS và báo cáo.
        </p>
      </div>

      <div className="p-4 lg:p-6 max-w-3xl space-y-6">
        {/* Section: Thông tin pháp lý */}
        <section className="bg-surface-container-lowest border border-border rounded-xl p-5 ambient-shadow">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary-fixed text-primary">
              <Icon name="business" size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Thông tin pháp lý</h2>
              <p className="text-xs text-muted-foreground">
                Bắt buộc cho hóa đơn VAT & báo cáo thuế.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="businessName">
                Tên doanh nghiệp <span className="text-destructive">*</span>
              </Label>
              <Input
                id="businessName"
                value={form.businessName ?? ""}
                onChange={(e) => update("businessName", e.target.value)}
                placeholder="VD: CÔNG TY TNHH CÀ PHÊ ABC"
              />
              <p className="text-[11px] text-muted-foreground">
                Tên xuất hiện trên hóa đơn — thường viết IN HOA theo điều lệ.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="taxCode">Mã số thuế</Label>
              <Input
                id="taxCode"
                value={form.taxCode ?? ""}
                onChange={(e) => update("taxCode", e.target.value)}
                placeholder="0123456789"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Số điện thoại</Label>
              <Input
                id="phone"
                value={form.phone ?? ""}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="0901234567"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Địa chỉ</Label>
              <Input
                id="address"
                value={form.address ?? ""}
                onChange={(e) => update("address", e.target.value)}
                placeholder="123 Nguyễn Văn A, P.B, Q.C, TP.HCM"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => update("email", e.target.value)}
                placeholder="contact@onebiz.vn"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={form.website ?? ""}
                onChange={(e) => update("website", e.target.value)}
                placeholder="https://onebiz.vn"
              />
            </div>
          </div>
        </section>

        {/* Section: Tài khoản ngân hàng (cho hóa đơn convertible) */}
        <section className="bg-surface-container-lowest border border-border rounded-xl p-5 ambient-shadow">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-status-success/10 text-status-success">
              <Icon name="account_balance" size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Tài khoản ngân hàng</h2>
              <p className="text-xs text-muted-foreground">
                Hiển thị trên hóa đơn để khách chuyển khoản. Không bắt buộc.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bankName">Tên ngân hàng</Label>
              <Input
                id="bankName"
                value={form.bankName ?? ""}
                onChange={(e) => update("bankName", e.target.value)}
                placeholder="Vietcombank"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankAccount">Số tài khoản</Label>
              <Input
                id="bankAccount"
                value={form.bankAccount ?? ""}
                onChange={(e) => update("bankAccount", e.target.value)}
                placeholder="0123456789"
              />
            </div>
          </div>
        </section>

        {/* Section: Branding (logo + footer) */}
        <section className="bg-surface-container-lowest border border-border rounded-xl p-5 ambient-shadow">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-status-warning/10 text-status-warning">
              <Icon name="palette" size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Thương hiệu & footer</h2>
              <p className="text-xs text-muted-foreground">
                Logo + ghi chú cuối hóa đơn / biên lai POS.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="logoUrl">Logo URL</Label>
              <Input
                id="logoUrl"
                value={form.logoUrl ?? ""}
                onChange={(e) => update("logoUrl", e.target.value)}
                placeholder="https://example.com/logo.png"
              />
              <p className="text-[11px] text-muted-foreground">
                Upload logo lên Supabase Storage rồi paste URL public vào đây.
              </p>
              {form.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logoUrl}
                  alt="Logo preview"
                  className="mt-2 h-16 w-auto border border-border rounded-md p-2 bg-white"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invoiceFooter">Ghi chú cuối hóa đơn</Label>
              <textarea
                id="invoiceFooter"
                value={form.invoiceFooter ?? ""}
                onChange={(e) => update("invoiceFooter", e.target.value)}
                placeholder="Cảm ơn quý khách. Hẹn gặp lại!"
                rows={3}
                className="flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="sticky bottom-0 bg-surface-container-lowest border-t border-border -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              getTenantBusinessInfo()
                .then(setForm)
                .finally(() => setLoading(false));
            }}
            disabled={saving}
          >
            Đặt lại
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && (
              <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />
            )}
            Lưu thay đổi
          </Button>
        </div>
      </div>
    </div>
  );
}
