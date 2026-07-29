/**
 * Hộp đen theo dõi thay đổi khách hàng trên POS (CEO 28/07/2026).
 *
 * Bối cảnh: nhân viên báo "khách tự nhảy về Khách lẻ". Data prod sạch (0 đơn
 * mất liên kết khách) → lỗi chỉ ở tầng màn hình. Hộp đen ghi lại MỌI lần
 * khách bị đổi: lúc nào, từ ai sang ai, đường code nào gây ra.
 *
 * CHỈ ghi localStorage của máy đó — không network, không DB, không ảnh hưởng
 * data web. Ring buffer 120 dòng, tự xoá dòng cũ.
 *
 * Cách đọc khi hỗ trợ nhân viên: mở DevTools Console trên máy POS, gõ
 *   __posCustomerLog()
 * → bảng các lần đổi khách kèm reason + stack.
 */

const KEY = "onebiz:pos:customer-log:v1";
const MAX_ENTRIES = 120;

interface CustomerRef {
  id: string;
  name: string;
}

export interface CustomerChangeEntry {
  ts: string;
  from: CustomerRef | null;
  to: CustomerRef | null;
  /** Nhãn call site: user / clear-cart / load-draft / f5-restore / tab-switch / truc-tiep */
  reason: string;
  /** Số dòng hàng trong giỏ lúc đổi — phân biệt ca "giỏ trống" */
  linesCount: number;
  /** 4 dòng stack đầu (bỏ frame log) — chỉ điểm đường code gọi */
  stack?: string;
}

/**
 * Lý do đổi khách do NGƯỜI DÙNG chủ động — không cần báo về máy chủ.
 * Mọi lý do khác mà làm MẤT khách đang chọn đều là bất thường.
 */
const DO_NGUOI_DUNG = new Set([
  "user-pick",
  "user-pick-scan",
  "user-clear",
  "load-draft",
]);

/** Chống spam: cùng một lý do chỉ báo lại sau 60 giây. */
const lanBaoCuoi = new Map<string, number>();

/**
 * 29/07: gửi ca BẤT THƯỜNG về máy chủ.
 *
 * CEO: "bắt anh qua máy nhân viên lấy thông tin rất là vô lý". Đúng — hộp đen
 * chỉ nằm ở máy nhân viên thì chủ quán không bao giờ xem được. Nay mỗi lần
 * khách bị gỡ NGOÀI Ý MUỐN, POS tự ghi một dòng vào nhật ký hệ thống để xem
 * từ xa ở Hệ thống → Nhật ký.
 *
 * Nguyên tắc giữ cho nhẹ:
 *  - CHỈ gửi ca mất khách ngoài ý muốn (bỏ mọi thao tác người dùng chủ động)
 *  - Cùng lý do chỉ gửi lại sau 60 giây
 *  - Gửi ngầm, hỏng thì thôi — tuyệt đối không chặn bán hàng
 */
function baoVeMayChu(entry: CustomerChangeEntry): void {
  const matKhach = entry.from && !entry.to;
  if (!matKhach || DO_NGUOI_DUNG.has(entry.reason)) return;

  const now = Date.now();
  const truoc = lanBaoCuoi.get(entry.reason) ?? 0;
  if (now - truoc < 60_000) return;
  lanBaoCuoi.set(entry.reason, now);

  // import động: không kéo tầng dịch vụ vào bundle POS lúc khởi động
  import("@/lib/services/supabase/audit")
    .then(({ recordAuditLog }) =>
      recordAuditLog({
        entityType: "pos_customer",
        entityId: entry.from?.id ?? "unknown",
        action: "auto_reset",
        oldData: { khach: entry.from?.name ?? null },
        newData: {
          lyDo: entry.reason,
          soDongGio: entry.linesCount,
          luc: entry.ts,
          duongCode: entry.stack?.slice(0, 300) ?? null,
          manHinh: typeof window !== "undefined" ? window.location.pathname : null,
        },
      }),
    )
    .catch(() => {
      // mất mạng / chưa đăng nhập — hộp đen ở máy vẫn còn bản ghi
    });
}

export function logCustomerChange(entry: Omit<CustomerChangeEntry, "ts" | "stack">): void {
  if (typeof window === "undefined") return;
  try {
    const stack = new Error().stack
      ?.split("\n")
      .slice(3, 7)
      .map((l) => l.trim())
      .join(" ← ");
    const full: CustomerChangeEntry = {
      ...entry,
      ts: new Date().toISOString(),
      stack,
    };
    const arr: CustomerChangeEntry[] = JSON.parse(
      localStorage.getItem(KEY) ?? "[]",
    );
    arr.push(full);
    while (arr.length > MAX_ENTRIES) arr.shift();
    localStorage.setItem(KEY, JSON.stringify(arr));
    baoVeMayChu(full);
  } catch {
    // localStorage đầy/tắt — bỏ qua, không được làm hỏng POS
  }
}

export function readCustomerLog(): CustomerChangeEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

// Helper cho người hỗ trợ: gõ __posCustomerLog() trong Console máy POS.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__posCustomerLog = () => {
    const log = readCustomerLog();
    // eslint-disable-next-line no-console
    console.table(
      log.map((e) => ({
        luc: e.ts.slice(5, 19).replace("T", " "),
        tu: e.from?.name ?? "(Khách lẻ)",
        sang: e.to?.name ?? "(Khách lẻ)",
        lyDo: e.reason,
        soDong: e.linesCount,
        stack: e.stack?.slice(0, 120),
      })),
    );
    return log;
  };
}
