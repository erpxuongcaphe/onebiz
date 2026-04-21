"use client";

import { useEffect, useState } from "react";

/**
 * Device binding — khoá 1 thiết bị (tablet/desktop POS) vào 1 chi nhánh cố định.
 *
 * Vấn đề: admin gán staff vào 1 quán nhưng tablet vẫn cho staff đổi chi nhánh
 * qua `PosBranchSelector` → lỡ tay ghi doanh thu sang quán khác. Trường hợp
 * CEO report (20/04): "POS FnB không chuyển chi nhánh được" thực ra là
 * staff SỢ bị nhầm nên không dám đổi — tương đương bug.
 *
 * Giải pháp: admin đăng nhập vào tablet (role `owner`) rồi bind localStorage.
 * Sau đó:
 *   - `switchBranch()` bị no-op khi có binding (silent block).
 *   - `PosBranchSelector` hiển thị lock icon + tên thiết bị thay vì dropdown.
 *   - Mỗi lần load, auth-context force `currentBranch` = branch đã bind.
 *
 * Trade-off vs DB-backed binding:
 *   - localStorage có thể bị xoá qua cache clear / private mode / incognito.
 *   - Không có central admin view để revoke từ xa.
 *   - Nhưng đủ cho 3-5 tablet ở coffee chain — đơn giản, không tạo bảng mới.
 *   - Nếu scale lên nhiều brand → migrate sang `device_bindings` table + token.
 */

export interface DeviceBinding {
  /** ID chi nhánh bị khoá — phải tồn tại trong `branches` của tenant. */
  branchId: string;
  /** Tên thiết bị do admin đặt, hiển thị trên lock badge (vd "iPad quán Nguyễn Trãi"). */
  deviceName: string;
  /** ISO timestamp khi bind — để log/debug. */
  boundAt: string;
}

const STORAGE_KEY = "pos_device_binding";
/** Custom event để notify các component cùng tab khi binding đổi. */
const CHANGE_EVENT = "device-binding-changed";

export function readDeviceBinding(): DeviceBinding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceBinding>;
    if (!parsed.branchId || !parsed.deviceName) return null;
    return {
      branchId: parsed.branchId,
      deviceName: parsed.deviceName,
      boundAt: parsed.boundAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeDeviceBinding(binding: Omit<DeviceBinding, "boundAt">) {
  if (typeof window === "undefined") return;
  const full: DeviceBinding = { ...binding, boundAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function clearDeviceBinding() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * React hook — subscribe đến binding state, re-render khi bind/unbind ở tab này
 * HOẶC tab khác (storage event).
 */
export function useDeviceBinding(): DeviceBinding | null {
  const [binding, setBinding] = useState<DeviceBinding | null>(null);

  useEffect(() => {
    setBinding(readDeviceBinding());

    const refresh = () => setBinding(readDeviceBinding());
    window.addEventListener(CHANGE_EVENT, refresh);
    // Cross-tab sync (storage event fire ở tab khác, không fire ở tab set).
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) refresh();
    });

    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return binding;
}
