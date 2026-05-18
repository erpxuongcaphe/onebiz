"use client";

/**
 * Cài đặt Kho & BOM (CEO 18/05/2026)
 *
 * 2 toggle chính:
 *   - allow_negative_stock: cho phép bán SKU khi NVL trong BOM không đủ tồn
 *   - require_bom_for_sku:  bắt buộc SKU phải có BOM trước khi cho bán
 *
 * Chỉ owner/admin được sửa (server enforce qua RPC set_tenant_setting).
 */

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import { isOwnerRole } from "@/lib/types/auth";
import {
  isAllowNegativeStock,
  setAllowNegativeStock,
  isRequireBomForSku,
  setRequireBomForSku,
} from "@/lib/services";
import { Icon } from "@/components/ui/icon";

interface ToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  warning?: string;
}

function ToggleRow({ label, description, value, onChange, disabled, warning }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{label}</span>
          {value && (
            <span className="inline-flex items-center rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5">
              Đang bật
            </span>
          )}
        </div>
        <p className="text-xs text-on-surface-variant">{description}</p>
        {warning && value && (
          <p className="mt-2 text-xs text-status-warning flex items-center gap-1">
            <Icon name="warning" size={12} />
            {warning}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors " +
          (value ? "bg-primary" : "bg-surface-container-highest") +
          (disabled ? " opacity-50 cursor-not-allowed" : "")
        }
        aria-checked={value}
        role="switch"
      >
        <span
          className={
            "inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition " +
            (value ? "translate-x-5" : "translate-x-0")
          }
        />
      </button>
    </div>
  );
}

export default function CaiDatKhoHangPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = isOwnerRole(user?.role) || user?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allowNegative, setAllowNegative] = useState(true);
  const [requireBom, setRequireBom] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [neg, req] = await Promise.all([
        isAllowNegativeStock(),
        isRequireBomForSku(),
      ]);
      setAllowNegative(neg);
      setRequireBom(req);
    } catch (err) {
      toast({
        variant: "error",
        title: "Không tải được cài đặt",
        description: err instanceof Error ? err.message : "Vui lòng thử lại sau.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateAllowNegative = async (value: boolean) => {
    if (!canEdit) return;
    setSaving(true);
    const prev = allowNegative;
    setAllowNegative(value);
    try {
      await setAllowNegativeStock(value);
      toast({
        variant: "success",
        title: value ? "Đã bật cho phép tồn âm" : "Đã tắt cho phép tồn âm",
        description: value
          ? "POS sẽ cho bán kể cả NVL không đủ — admin tự cân đối kế toán."
          : "POS sẽ chặn bán nếu NVL trong BOM không đủ tồn.",
        duration: 6000,
      });
    } catch (err) {
      setAllowNegative(prev);
      toast({
        variant: "error",
        title: "Không cập nhật được",
        description: err instanceof Error ? err.message : "Vui lòng thử lại.",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateRequireBom = async (value: boolean) => {
    if (!canEdit) return;
    setSaving(true);
    const prev = requireBom;
    setRequireBom(value);
    try {
      await setRequireBomForSku(value);
      toast({
        variant: "success",
        title: value ? "Đã bật bắt buộc BOM" : "Đã tắt bắt buộc BOM",
        description: value
          ? "POS sẽ reject nếu SKU đánh dấu has_bom=true mà chưa setup BOM."
          : "POS vẫn cho bán SKU chưa setup BOM — chỉ cảnh báo trong toast.",
        duration: 6000,
      });
    } catch (err) {
      setRequireBom(prev);
      toast({
        variant: "error",
        title: "Không cập nhật được",
        description: err instanceof Error ? err.message : "Vui lòng thử lại.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Cài đặt kho & công thức"
        subtitle="Cấu hình hành vi BOM, tồn kho khi bán hàng"
      />

      <div className="px-4 pb-8 space-y-6">
        {!canEdit && (
          <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-foreground">
            <Icon name="lock" size={14} className="inline-block mr-1 align-text-bottom" />
            Chỉ chủ sở hữu (owner) hoặc quản trị (admin) mới được đổi các cài đặt này.
          </div>
        )}

        <section className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Kiểm soát tồn kho khi bán</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Khi POS bán SKU có BOM, server tự trừ NVL theo công thức.
              Các flag dưới đây kiểm soát hành vi khi NVL không đủ tồn hoặc
              chưa setup BOM.
            </p>
          </div>
          <div className="px-4">
            {loading ? (
              <div className="py-8 text-center text-on-surface-variant text-sm">
                Đang tải cài đặt...
              </div>
            ) : (
              <>
                <ToggleRow
                  label="Cho phép bán khi NVL không đủ tồn"
                  description="Khi bật, POS vẫn cho thanh toán dù NVL trong BOM không đủ — tồn kho sẽ âm. Admin tự cân đối qua nhập bổ sung / kiểm kê sau. Khi tắt, POS sẽ reject với thông báo rõ NVL nào thiếu."
                  value={allowNegative}
                  onChange={updateAllowNegative}
                  disabled={!canEdit || saving}
                  warning="Tồn kho có thể âm — chỉ dùng giai đoạn đầu khi data BOM chưa chính xác."
                />
                <ToggleRow
                  label="Bắt buộc SKU phải có BOM trước khi bán"
                  description="Khi bật, POS reject nếu SKU đánh dấu has_bom=true nhưng chưa setup công thức. Khi tắt, vẫn cho bán + cảnh báo trong toast (mặc định)."
                  value={requireBom}
                  onChange={updateRequireBom}
                  disabled={!canEdit || saving}
                />
              </>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Icon name="info" size={16} className="text-primary" />
            Cách hoạt động
          </h3>
          <ul className="text-xs text-on-surface-variant space-y-1.5 ml-5 list-disc">
            <li>
              <b>SKU có BOM</b>: khi bán 1 ly → server tìm BOM cho chi nhánh hiện tại
              (ưu tiên BOM riêng, fallback BOM global) → trừ từng NVL theo công thức.
            </li>
            <li>
              <b>SKU chưa setup BOM</b>: badge vàng &quot;Chưa setup&quot; trên danh sách hàng hoá.
              POS vẫn cho bán (nếu &quot;Bắt buộc BOM&quot; tắt) nhưng không trừ NVL → COGS không chính xác.
            </li>
            <li>
              <b>Báo cáo</b>: xem &quot;Tiêu hao NVL theo chi nhánh&quot; và &quot;COGS thực
              theo BOM&quot; trong menu Phân tích.
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
