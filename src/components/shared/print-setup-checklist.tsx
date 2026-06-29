"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  getTenantBusinessInfo,
  getBranchPrintInfo,
} from "@/lib/services";
import type { TenantBusinessInfo, BranchPrintInfo } from "@/lib/services";

/**
 * Thẻ "Hoàn thiện thông tin in" — chủ động soi thông tin in còn thiếu để bản in
 * ra khách hàng đầy đủ/chuyên nghiệp.
 *
 * CHỈ ĐỌC dữ liệu (getTenantBusinessInfo + getBranchPrintInfo cho từng chi
 * nhánh) — không ghi/sửa gì. Tính một danh sách mục kiểm tra (logo công ty,
 * tên doanh nghiệp in, địa chỉ chi nhánh, MST chi nhánh) và hiển thị mục nào
 * đã đủ / mục nào còn thiếu kèm gợi ý chỗ điền.
 */

/** Một mục kiểm tra trên checklist. */
interface CheckItem {
  /** Khoá ổn định để React render danh sách. */
  key: string;
  /** Nhãn ngắn của mục, VD "Logo công ty". */
  label: string;
  /** true = đã đủ; false = còn thiếu. */
  ok: boolean;
  /** Câu gợi ý chỗ điền — chỉ hiện khi mục còn thiếu. */
  hint?: string;
}

/** Liệt kê tối đa 3 tên chi nhánh + "…" nếu còn nhiều hơn. */
function joinBranchNames(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")}…`;
}

/**
 * Tính các mục kiểm tra từ thông tin tenant + thông tin in của các chi nhánh.
 * Tách riêng để giữ phần render gọn và dễ đọc.
 */
function computeChecks(
  tenant: TenantBusinessInfo | null,
  branchInfos: BranchPrintInfo[],
): CheckItem[] {
  const total = branchInfos.length;

  // Chi nhánh thiếu địa chỉ / thiếu MST (lấy tên để liệt kê gợi ý).
  const missingAddress: string[] = [];
  const missingTax: string[] = [];
  for (const info of branchInfos) {
    const name = info.branchName?.trim() || "Chi nhánh chưa đặt tên";
    if (!info.address || info.address.trim() === "") missingAddress.push(name);
    if (!info.taxCode || info.taxCode.trim() === "") missingTax.push(name);
  }
  const haveAddress = total - missingAddress.length;
  const haveTax = total - missingTax.length;

  const hasLogo = !!tenant?.logoUrl && tenant.logoUrl.trim() !== "";
  const hasBusinessName =
    !!tenant?.businessName && tenant.businessName.trim() !== "";

  return [
    {
      key: "logo",
      label: "Logo công ty",
      ok: hasLogo,
      hint: "Chưa có logo — bản in sẽ không có logo. Điền ở thẻ Logo & Lời cảm ơn bên dưới.",
    },
    {
      key: "businessName",
      label: "Tên doanh nghiệp in",
      ok: hasBusinessName,
      hint: "Chưa có tên DN in — đầu phiếu sẽ thiếu tên thương hiệu.",
    },
    {
      key: "branchAddress",
      label:
        total > 0
          ? `Địa chỉ chi nhánh (${haveAddress}/${total} đã có)`
          : "Địa chỉ chi nhánh",
      ok: total === 0 || missingAddress.length === 0,
      hint:
        missingAddress.length > 0
          ? `${missingAddress.length}/${total} chi nhánh chưa có địa chỉ: ${joinBranchNames(
              missingAddress,
            )}. Bản in của chi nhánh đó sẽ thiếu địa chỉ. Điền ở hồ sơ chi nhánh hoặc ô địa chỉ in riêng trong thẻ Thông tin chi nhánh.`
          : undefined,
    },
    {
      key: "branchTax",
      label:
        total > 0
          ? `MST chi nhánh (${haveTax}/${total} đã có)`
          : "MST chi nhánh",
      ok: total === 0 || missingTax.length === 0,
      hint:
        missingTax.length > 0
          ? `${missingTax.length}/${total} chi nhánh chưa có MST: ${joinBranchNames(
              missingTax,
            )}. Bản in của chi nhánh đó sẽ thiếu MST. Điền MST ở hồ sơ chi nhánh hoặc ô "MST in riêng" trong thẻ Thông tin chi nhánh.`
          : undefined,
    },
  ];
}

export function PrintSetupChecklist() {
  const { branches } = useAuth();

  const [tenant, setTenant] = useState<TenantBusinessInfo | null>(null);
  const [branchInfos, setBranchInfos] = useState<BranchPrintInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Tải thông tin tenant + thông tin in của TẤT CẢ chi nhánh khi mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getTenantBusinessInfo().catch(() => null),
      Promise.all(
        branches.map((b) =>
          getBranchPrintInfo(b.id).catch(
            () => ({ override: null }) as BranchPrintInfo,
          ),
        ),
      ),
    ])
      .then(([tenantInfo, infos]) => {
        if (cancelled) return;
        setTenant(tenantInfo);
        setBranchInfos(infos);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branches]);

  const checks = computeChecks(tenant, branchInfos);
  const missingCount = checks.filter((c) => !c.ok).length;
  const allOk = missingCount === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon name="badge" />
          Hoàn thiện thông tin in
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Đảm bảo bản in ra khách hàng đầy đủ tên DN, MST, địa chỉ, logo.
        </p>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Icon name="progress_activity" size={18} className="animate-spin" />
            Đang kiểm tra thông tin in...
          </div>
        ) : allOk ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <Icon
              name="check_circle"
              size={20}
              fill
              className="shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <span className="font-medium text-emerald-700 dark:text-emerald-300">
              Thông tin in đã đầy đủ — bản in sẽ ra chuyên nghiệp.
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Dòng tổng: còn bao nhiêu mục cần hoàn thiện. */}
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-sm">
              <Icon
                name="info"
                size={18}
                className="shrink-0 text-amber-600 dark:text-amber-400"
              />
              <span className="font-medium text-amber-700 dark:text-amber-300">
                Còn {missingCount} mục cần hoàn thiện
              </span>
            </div>

            {/* Danh sách từng mục: đủ → ✓, thiếu → ⚠ + gợi ý. */}
            <ul className="space-y-2">
              {checks.map((item) => (
                <li
                  key={item.key}
                  className="flex items-start gap-2 rounded-lg border border-border bg-card p-2.5"
                >
                  <Icon
                    name={item.ok ? "check_circle" : "warning"}
                    size={18}
                    fill={item.ok}
                    className={
                      item.ok
                        ? "mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                        : "mt-0.5 shrink-0 text-amber-500 dark:text-amber-400"
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    {!item.ok && item.hint && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.hint}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
