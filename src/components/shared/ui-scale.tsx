"use client";

import { useEffect } from "react";

/**
 * Gắn class `ui-scale-90` lên <html> khi ở khu back-office → toàn bộ giao diện
 * hiển thị 90% (CEO 25/07/2026: 100% quá to, bị giới hạn nội dung nhìn thấy).
 *
 * Đặt ở <html> chứ không phải div con vì dialog/toast/dropdown render qua portal
 * ra <body> — zoom ở div con thì chúng nằm ngoài và sẽ to lệch.
 *
 * POS / MKT / SOP không mount component này nên giữ 100%: thu ngân bấm tablet,
 * thu nhỏ làm nút chạm từ 44px xuống 39,6px là dưới ngưỡng bấm thoải mái.
 * Rời khỏi khu (main) → unmount → class tự gỡ.
 */
export function UiScale() {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("ui-scale-90");
    return () => el.classList.remove("ui-scale-90");
  }, []);

  return null;
}
