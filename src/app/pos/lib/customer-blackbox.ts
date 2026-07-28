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

export function logCustomerChange(entry: Omit<CustomerChangeEntry, "ts" | "stack">): void {
  if (typeof window === "undefined") return;
  try {
    const stack = new Error().stack
      ?.split("\n")
      .slice(3, 7)
      .map((l) => l.trim())
      .join(" ← ");
    const arr: CustomerChangeEntry[] = JSON.parse(
      localStorage.getItem(KEY) ?? "[]",
    );
    arr.push({ ...entry, ts: new Date().toISOString(), stack });
    while (arr.length > MAX_ENTRIES) arr.shift();
    localStorage.setItem(KEY, JSON.stringify(arr));
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
