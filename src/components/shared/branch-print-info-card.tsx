"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/lib/contexts/toast-context";
import { getBranchPrintInfo, setBranchPrintBrand } from "@/lib/services";
import type { BranchPrintInfo } from "@/lib/services";

/**
 * Thẻ "Thông tin in theo chi nhánh" — TẦNG chi nhánh của Cài đặt In V3.
 *
 * Mỗi bản in tự lấy ĐỊA CHỈ + SĐT của chi nhánh đang in (kế thừa từ hồ sơ
 * chi nhánh). Card này cho phép xem địa chỉ/SĐT sẽ in cho từng chi nhánh và
 * — nếu cần — đặt override in RIÊNG (địa chỉ in / SĐT in / logo riêng) khác
 * với hồ sơ chi nhánh.
 *
 * Service:
 * - getBranchPrintInfo(branchId) → { branchName, address, phone, override }
 * - setBranchPrintBrand(branchId, brand | null) — null = xoá override.
 */

/** Bản nháp form sửa override của 1 chi nhánh. */
interface DraftForm {
  address: string;
  phone: string;
  logoUrl: string;
}

function draftFromInfo(info: BranchPrintInfo | undefined): DraftForm {
  // Prefill TỪ override (không phải địa chỉ hồ sơ) vì đây là phần in riêng.
  const ov = info?.override ?? null;
  return {
    address: ov?.address ?? "",
    phone: ov?.phone ?? "",
    logoUrl: ov?.logoUrl ?? "",
  };
}

export function BranchPrintInfoCard() {
  const { branches } = useAuth();
  const { toast } = useToast();

  // Map branchId → thông tin in đã tải.
  const [infoMap, setInfoMap] = useState<Record<string, BranchPrintInfo>>({});
  const [loading, setLoading] = useState(true);

  // Form sửa: mở/đóng + bản nháp + đang lưu — đều theo branchId.
  const [openForm, setOpenForm] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftForm>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Tải thông tin in của TẤT CẢ chi nhánh khi mount (hoặc khi list đổi).
  useEffect(() => {
    if (branches.length === 0) {
      setInfoMap({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      branches.map((b) =>
        getBranchPrintInfo(b.id)
          .then((info) => [b.id, info] as const)
          .catch(() => [b.id, { override: null } as BranchPrintInfo] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        const next: Record<string, BranchPrintInfo> = {};
        for (const [id, info] of entries) next[id] = info;
        setInfoMap(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branches]);

  // Mở/đóng form sửa của 1 chi nhánh. Khi mở → prefill bản nháp từ override.
  const toggleForm = useCallback(
    (branchId: string) => {
      setOpenForm((prev) => {
        const willOpen = !prev[branchId];
        if (willOpen) {
          setDrafts((d) => ({
            ...d,
            [branchId]: draftFromInfo(infoMap[branchId]),
          }));
        }
        return { ...prev, [branchId]: willOpen };
      });
    },
    [infoMap],
  );

  const closeForm = useCallback((branchId: string) => {
    setOpenForm((prev) => ({ ...prev, [branchId]: false }));
  }, []);

  const updateDraft = useCallback(
    (branchId: string, patch: Partial<DraftForm>) => {
      setDrafts((prev) => ({
        ...prev,
        [branchId]: { ...draftFromInfo(undefined), ...prev[branchId], ...patch },
      }));
    },
    [],
  );

  // Lưu override: gom các field có nhập; tất cả trống → xoá override (null).
  const handleSave = useCallback(
    async (branchId: string) => {
      const draft = drafts[branchId] ?? draftFromInfo(undefined);
      const address = draft.address.trim();
      const phone = draft.phone.trim();
      const logoUrl = draft.logoUrl.trim();

      const brand: { address?: string; phone?: string; logoUrl?: string } = {};
      if (address) brand.address = address;
      if (phone) brand.phone = phone;
      if (logoUrl) brand.logoUrl = logoUrl;
      const isEmpty = Object.keys(brand).length === 0;

      setSavingId(branchId);
      try {
        await setBranchPrintBrand(branchId, isEmpty ? null : brand);
        // Tải lại đúng dòng này để hiển thị địa chỉ/SĐT + badge mới nhất.
        const fresh = await getBranchPrintInfo(branchId);
        setInfoMap((prev) => ({ ...prev, [branchId]: fresh }));
        setOpenForm((prev) => ({ ...prev, [branchId]: false }));
        toast({
          variant: "success",
          title: isEmpty ? "Đã xoá thông tin in riêng" : "Đã lưu thông tin in riêng",
          description: isEmpty
            ? "Chi nhánh sẽ in theo địa chỉ + SĐT trong hồ sơ chi nhánh."
            : "Bản in của chi nhánh này sẽ dùng thông tin vừa nhập.",
        });
      } catch (err) {
        toast({
          variant: "error",
          title: "Lỗi lưu thông tin in",
          description: err instanceof Error ? err.message : "Vui lòng thử lại.",
        });
      } finally {
        setSavingId(null);
      }
    },
    [drafts, toast],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon name="storefront" />
          Thông tin in theo chi nhánh
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Mỗi bản in tự lấy địa chỉ + SĐT của chi nhánh đang in. Địa chỉ lấy sẵn
          từ hồ sơ chi nhánh — chỉ điền ô bên dưới nếu muốn in khác hồ sơ.
        </p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Icon name="progress_activity" size={18} className="animate-spin" />
            Đang tải thông tin in của các chi nhánh...
          </div>
        ) : branches.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Icon name="storefront" size={28} className="text-muted-foreground" />
            Chưa có chi nhánh.
          </div>
        ) : (
          <div className="space-y-3">
            {branches.map((branch) => {
              const info = infoMap[branch.id];
              const address = info?.address;
              const phone = info?.phone;
              const hasOverride = !!info?.override;
              const isOpen = !!openForm[branch.id];
              const isSaving = savingId === branch.id;
              const draft = drafts[branch.id] ?? draftFromInfo(info);

              return (
                <div
                  key={branch.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  {/* Hàng tiêu đề: tên chi nhánh + badge + nút sửa */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{branch.name}</span>
                        {hasOverride && (
                          <Badge variant="outline" className="text-[11px]">
                            Có chỉnh riêng
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        <p>
                          <span className="font-medium text-foreground">
                            Địa chỉ in:
                          </span>{" "}
                          {address || "— (chưa có trong hồ sơ chi nhánh)"}
                        </p>
                        <p>
                          <span className="font-medium text-foreground">ĐT:</span>{" "}
                          {phone || "—"}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isOpen ? "secondary" : "outline"}
                      onClick={() => toggleForm(branch.id)}
                    >
                      <Icon
                        name={isOpen ? "expand_less" : "edit"}
                        size={14}
                        className="mr-1"
                      />
                      Sửa thông tin in riêng
                    </Button>
                  </div>

                  {/* Form sửa override — mở khi bấm nút */}
                  {isOpen && (
                    <div className="mt-3 space-y-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">
                        Để trống = dùng của hồ sơ chi nhánh. Chỉ điền khi muốn in
                        khác hồ sơ.
                      </p>

                      <div className="space-y-1">
                        <label className="text-sm font-medium">Địa chỉ in riêng</label>
                        <Input
                          value={draft.address}
                          onChange={(e) =>
                            updateDraft(branch.id, { address: e.target.value })
                          }
                          placeholder="Để trống = dùng của hồ sơ chi nhánh"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-sm font-medium">SĐT in riêng</label>
                        <Input
                          value={draft.phone}
                          onChange={(e) =>
                            updateDraft(branch.id, { phone: e.target.value })
                          }
                          placeholder="Để trống = dùng của hồ sơ chi nhánh"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-sm font-medium">Logo URL riêng</label>
                        <Input
                          value={draft.logoUrl}
                          onChange={(e) =>
                            updateDraft(branch.id, { logoUrl: e.target.value })
                          }
                          placeholder="Để trống = dùng của hồ sơ chi nhánh"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => handleSave(branch.id)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <>
                              <Icon
                                name="progress_activity"
                                size={14}
                                className="mr-1 animate-spin"
                              />
                              Đang lưu...
                            </>
                          ) : (
                            <>
                              <Icon name="save" size={14} className="mr-1" />
                              Lưu
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => closeForm(branch.id)}
                          disabled={isSaving}
                        >
                          Hủy
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
