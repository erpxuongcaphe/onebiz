"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Giữ trạng thái "đang chạy" cho tới khi màn hình ĐÃ hiện dữ liệu mới.
 *
 * VÌ SAO CẦN (đo thật trên prod 15/07, thao tác tạo kênh):
 *   • gọi máy chủ ghi dữ liệu ......... 3,03 giây
 *   • dựng lại màn hình sau đó ........ 2,72 giây
 * Mẫu code cũ tắt "đang chạy" (và đóng hộp thoại) NGAY khi máy chủ trả lời —
 * tức ở giây thứ 3 — trong khi danh sách mãi giây 5,7 mới đổi. Gần 3 giây đó
 * người dùng thấy hộp thoại biến mất mà màn hình y nguyên, KHÔNG một dấu hiệu
 * nào → tưởng hỏng và bấm lại (đẻ bản ghi trùng).
 *
 * Lưu ý: `router.refresh()` KHÔNG hỏng và các trang MKT đều force-dynamic —
 * dữ liệu vẫn tự cập nhật. Vấn đề thuần tuý là khoảng lặng không phản hồi.
 *
 * CÁCH DÙNG:
 *   const { refresh, refreshing } = useMktRefresh();
 *   await mktPost(...);
 *   refresh(() => setOpen(false));   // hộp thoại chỉ đóng khi dữ liệu đã mới
 *   ...
 *   <Button disabled={busy || refreshing}>
 *
 * `after` chạy BÊN TRONG cùng nhịp chuyển tiếp với dữ liệu mới, nên các thay
 * đổi giao diện trong đó (đóng hộp thoại, xoá form…) được áp cùng lúc với dữ
 * liệu — không còn cảnh đóng trước, dữ liệu tới sau.
 */
export function useMktRefresh() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();

  function refresh(after?: () => void) {
    startTransition(() => {
      router.refresh();
      after?.();
    });
  }

  return { refresh, refreshing };
}
