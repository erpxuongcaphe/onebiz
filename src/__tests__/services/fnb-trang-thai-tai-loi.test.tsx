import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 16/08/2026 — A1: màn F&B tải lỗi phải NÓI THẬT.
 *
 * CEO nêu 5 điều kiện hành vi, test này khoá từng điều:
 *   1. tải lỗi KHÔNG hiện cấu hình mặc định
 *   2. tải lỗi KHÔNG hiện KPI 0 hoặc trạng thái rỗng giả
 *   3. nút lưu / chỉnh sửa bị khoá khi dữ liệu chưa tải
 *   4. bấm Thử lại thì tải đúng dữ liệu
 *   5. kết quả cũ không đè kết quả mới
 *
 * Lỗi gốc ở `cai-dat/fnb-presets`: `.catch(() => {})` nuốt lỗi rồi để nguyên
 * giá trị mặc định của useState. Người dùng tưởng đã tải xong, bấm Lưu là ghi
 * mặc định ĐÈ LÊN cấu hình thật trên máy chủ.
 */

// ── Giả lập tầng dịch vụ ──
const getDeliveryPlatformSettings = vi.fn();
const getDiscountPresets = vi.fn();
const updateDeliveryPlatformSettings = vi.fn();
const saveDiscountPresets = vi.fn();
const getModifierStats = vi.fn();
const getTablesByBranch = vi.fn();
const getBranchSettings = vi.fn();

/** Chi nhánh đang chọn — đổi được giữa các lần render để dựng cảnh đua. */
let chiNhanhDangChon = "cn-1";

vi.mock("@/lib/services/supabase/fnb-platform-settings", async () => {
  const thuc = await vi.importActual<
    typeof import("@/lib/services/supabase/fnb-platform-settings")
  >("@/lib/services/supabase/fnb-platform-settings");
  return {
    ...thuc,
    getDeliveryPlatformSettings: () => getDeliveryPlatformSettings(),
    getDiscountPresets: () => getDiscountPresets(),
    updateDeliveryPlatformSettings: (...a: unknown[]) =>
      updateDeliveryPlatformSettings(...a),
    saveDiscountPresets: (...a: unknown[]) => saveDiscountPresets(...a),
  };
});

vi.mock("@/lib/services/supabase/fnb-analytics", () => ({
  getModifierStats: (...a: unknown[]) => getModifierStats(...a),
}));

vi.mock("@/lib/services/supabase/fnb-tables", () => ({
  getTablesByBranch: (...a: unknown[]) => getTablesByBranch(...a),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  bulkCreateTables: vi.fn(),
  renameZone: vi.fn(),
  deleteZone: vi.fn(),
}));

vi.mock("@/lib/services/supabase/branches", () => ({
  getBranchSettings: (...a: unknown[]) => getBranchSettings(...a),
  updateBranchSettings: vi.fn(),
}));

// `toast` phải là CÙNG một hàm giữa các lần render: nhiều useCallback có nó
// trong danh sách phụ thuộc, hàm mới mỗi render sẽ khiến effect tải lại vô hạn.
const toastOnDinh = vi.fn();
vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: toastOnDinh }),
  useAuth: () => ({
    tenant: { id: "tn-1" },
    user: { id: "u-1", branchId: "cn-1" },
    branches: [{ id: "cn-1", name: "Kho Tổng", isDefault: true }],
    activeBranchId: chiNhanhDangChon,
    hasPermission: () => true,
    switchBranch: vi.fn(),
  }),
  useBranchFilter: () => ({
    activeBranchId: chiNhanhDangChon,
    branchLabel: "Kho Tổng",
    isReady: true,
  }),
}));

// Chặn quyền + canvas Konva — không thuộc phạm vi trạng thái tải.
vi.mock("@/components/shared/permission-page", () => ({
  PermissionPage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/app/(main)/he-thong/quan-ly-ban/floor-plan-editor", () => ({
  FloorPlanEditor: () => <div data-testid="so-do-ban" />,
}));

import FnbPresetsPage from "@/app/(main)/cai-dat/fnb-presets/page";
import FnbModifierReportPage from "@/app/(main)/phan-tich/fnb-modifier/page";
import QuanLyBanPage from "@/app/(main)/he-thong/quan-ly-ban/page";
import { DEFAULT_DELIVERY_PLATFORM_SETTINGS } from "@/lib/services/supabase/fnb-platform-settings";

/** Lời hứa hoãn được — dùng để ép lượt tải cũ về SAU lượt mới. */
function loiHuaChoTay<T>() {
  let xong!: (v: T) => void;
  const p = new Promise<T>((res) => {
    xong = res;
  });
  return { p, xong };
}

function ban(id: string, so: number, khu: string) {
  return {
    id,
    tableNumber: so,
    zone: khu,
    seats: 4,
    status: "available",
    sortOrder: so,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chiNhanhDangChon = "cn-1";
  getBranchSettings.mockResolvedValue({ posZoneOrder: [] });
});

// ══════════════════════════════════════════════════════════════════════
describe("Cài đặt POS F&B — tải lỗi không được hiện cấu hình mặc định", () => {
  it("tải hỏng: báo lỗi, KHÔNG hiện form, nên không có nút Lưu để ghi đè", async () => {
    getDeliveryPlatformSettings.mockRejectedValue(new Error("Mất kết nối"));
    getDiscountPresets.mockRejectedValue(new Error("Mất kết nối"));

    render(<FnbPresetsPage />);

    await waitFor(() =>
      expect(screen.getByText("Không tải được cấu hình POS F&B")).toBeTruthy(),
    );
    // Điều kiện 1 + 3: không ô nhập nào, không nút Lưu nào.
    expect(screen.queryByText("Lưu cấu hình sàn")).toBeNull();
    expect(document.querySelectorAll("input").length).toBe(0);
    expect(screen.getByText("Thử lại")).toBeTruthy();
    // Không được mượn trạng thái rỗng để che lỗi.
    expect(screen.queryByText(/Chưa có khuyến mãi nhanh nào/)).toBeNull();
  });

  it("ở trạng thái lỗi thì KHÔNG hàm ghi nào bị gọi", async () => {
    getDeliveryPlatformSettings.mockRejectedValue(new Error("Mất kết nối"));
    getDiscountPresets.mockRejectedValue(new Error("Mất kết nối"));

    render(<FnbPresetsPage />);
    await waitFor(() =>
      expect(screen.getByText("Không tải được cấu hình POS F&B")).toBeTruthy(),
    );

    expect(updateDeliveryPlatformSettings).not.toHaveBeenCalled();
    expect(saveDiscountPresets).not.toHaveBeenCalled();
  });

  it("bấm Thử lại: gọi lại dịch vụ và hiện đúng dữ liệu thật", async () => {
    getDeliveryPlatformSettings.mockRejectedValueOnce(new Error("Mất kết nối"));
    getDiscountPresets.mockRejectedValueOnce(new Error("Mất kết nối"));

    render(<FnbPresetsPage />);
    await waitFor(() =>
      expect(screen.getByText("Không tải được cấu hình POS F&B")).toBeTruthy(),
    );
    expect(getDeliveryPlatformSettings).toHaveBeenCalledTimes(1);

    getDeliveryPlatformSettings.mockResolvedValue({
      ...DEFAULT_DELIVERY_PLATFORM_SETTINGS,
      shopee_food: { active: true, commissionPercent: 27 },
    });
    getDiscountPresets.mockResolvedValue([
      { id: "km-1", name: "Giảm giờ vàng", mode: "percent", value: 15, active: true },
    ]);

    fireEvent.click(screen.getByText("Thử lại"));

    await waitFor(() =>
      expect(screen.getByDisplayValue("Giảm giờ vàng")).toBeTruthy(),
    );
    expect(getDeliveryPlatformSettings).toHaveBeenCalledTimes(2);
    // Điều kiện 4: màn lỗi biến mất, nút Lưu mở lại.
    expect(screen.queryByText("Không tải được cấu hình POS F&B")).toBeNull();
    expect(screen.getByText("Lưu cấu hình sàn")).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════
describe("Báo cáo tuỳ chọn F&B — tải lỗi không được hiện rỗng giả", () => {
  it("tải hỏng: báo lỗi, KHÔNG hiện trạng thái 'chưa có dữ liệu'", async () => {
    getModifierStats.mockRejectedValue(new Error("Máy chủ bận"));

    render(<FnbModifierReportPage />);

    await waitFor(() =>
      expect(screen.getByText("Không tải được báo cáo tuỳ chọn")).toBeTruthy(),
    );
    // Điều kiện 2.
    expect(screen.queryByText(/Chưa có dữ liệu/i)).toBeNull();
    expect(screen.getByText("Thử lại")).toBeTruthy();
  });

  it("bấm Thử lại: gọi lại và hiện số thật", async () => {
    getModifierStats.mockRejectedValueOnce(new Error("Máy chủ bận"));

    render(<FnbModifierReportPage />);
    await waitFor(() =>
      expect(screen.getByText("Không tải được báo cáo tuỳ chọn")).toBeTruthy(),
    );
    expect(getModifierStats).toHaveBeenCalledTimes(1);

    getModifierStats.mockResolvedValue([
      {
        groupId: "g-1",
        groupName: "Mức đường",
        optionId: "o-1",
        optionLabel: "70% đường",
        count: 128,
        totalQuantity: 150,
        totalPriceDelta: 0,
      },
    ]);
    fireEvent.click(screen.getByText("Thử lại"));

    await waitFor(() => expect(screen.getByText("70% đường")).toBeTruthy());
    expect(getModifierStats).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Không tải được báo cáo tuỳ chọn")).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
describe("Quản lý bàn — lỗi tải và cảnh đua đổi chi nhánh", () => {
  it("tải hỏng: báo lỗi, KHÔNG hiện 'chưa có bàn' rỗng giả", async () => {
    getTablesByBranch.mockRejectedValue(new Error("Mất kết nối"));

    render(<QuanLyBanPage />);

    await waitFor(() =>
      expect(screen.getByText("Không tải được danh sách bàn")).toBeTruthy(),
    );
    expect(screen.getByText("Thử lại")).toBeTruthy();
    // Không được hiện màn "chưa có khu vực / bàn nào" như thể chi nhánh trống.
    expect(screen.queryByText(/Chưa có khu vực nào/i)).toBeNull();
  });

  it("đổi chi nhánh: kết quả chi nhánh CŨ về sau KHÔNG được đè chi nhánh MỚI", async () => {
    const cu = loiHuaChoTay<ReturnType<typeof ban>[]>();
    const moi = loiHuaChoTay<ReturnType<typeof ban>[]>();
    getTablesByBranch
      .mockReturnValueOnce(cu.p) // cn-1 — mạng chậm
      .mockReturnValueOnce(moi.p); // cn-2 — về trước

    const { rerender } = render(<QuanLyBanPage />);
    await waitFor(() => expect(getTablesByBranch).toHaveBeenCalledTimes(1));

    // Người dùng đổi sang chi nhánh khác khi lượt cũ chưa về.
    chiNhanhDangChon = "cn-2";
    rerender(<QuanLyBanPage />);
    await waitFor(() => expect(getTablesByBranch).toHaveBeenCalledTimes(2));

    // Chi nhánh MỚI về trước.
    moi.xong([ban("b-moi", 22, "Khu Sân Vườn")]);
    await waitFor(() => expect(screen.getByText("Khu Sân Vườn")).toBeTruthy());

    // Chi nhánh CŨ về sau — phải bị bỏ qua, màn vẫn là chi nhánh mới.
    cu.xong([ban("b-cu", 11, "Khu Tầng Trệt")]);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("Khu Tầng Trệt")).toBeNull();
    expect(screen.getByText("Khu Sân Vườn")).toBeTruthy();
  });
});
