import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 16/08/2026 — mục B: tìm kiếm, bộ lọc, xoá bộ lọc cho màn F&B.
 *
 * Điều quan trọng nhất không phải "lọc được", mà là **không khớp bộ lọc phải
 * khác hẳn chưa có dữ liệu**. Nếu lọc xong màn hiện "Chưa có nhóm nào" thì
 * người dùng tưởng mất dữ liệu và đi tạo lại — sinh dữ liệu trùng.
 */

const listModifierGroups = vi.fn();
const listModifierOptions = vi.fn();
const getFnbReadiness = vi.fn();
const getTablesByBranch = vi.fn();
const getBranchSettings = vi.fn();
const toastOnDinh = vi.fn();

vi.mock("@/lib/services/supabase/modifier-groups", async () => {
  const thuc = await vi.importActual<
    typeof import("@/lib/services/supabase/modifier-groups")
  >("@/lib/services/supabase/modifier-groups");
  return {
    ...thuc,
    listModifierGroups: () => listModifierGroups(),
    listModifierOptions: (...a: unknown[]) => listModifierOptions(...a),
    createModifierGroup: vi.fn(),
    updateModifierGroup: vi.fn(),
    deleteModifierGroup: vi.fn(),
    createModifierOption: vi.fn(),
    updateModifierOption: vi.fn(),
    deleteModifierOption: vi.fn(),
    seedFnbVnPreset: vi.fn(),
  };
});

vi.mock("@/lib/services/supabase/fnb-readiness", () => ({
  getFnbReadiness: (...a: unknown[]) => getFnbReadiness(...a),
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

vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: toastOnDinh }),
  useAuth: () => ({
    tenant: { id: "tn-1" },
    user: { id: "u-1", branchId: "cn-1" },
    branches: [{ id: "cn-1", name: "Kho Tổng", isDefault: true }],
    activeBranchId: "cn-1",
    hasPermission: () => true,
    switchBranch: vi.fn(),
  }),
  useBranchFilter: () => ({
    activeBranchId: "cn-1",
    branchLabel: "Kho Tổng",
    isReady: true,
  }),
}));

// tuy-chon-fnb lấy useAuth thẳng từ auth-context, không qua "@/lib/contexts".
vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({
    tenant: { id: "tn-1" },
    user: { id: "u-1", branchId: "cn-1" },
    branches: [{ id: "cn-1", name: "Kho Tổng", isDefault: true }],
    activeBranchId: "cn-1",
    currentBranch: { id: "cn-1", name: "Kho Tổng" },
    hasPermission: () => true,
    switchBranch: vi.fn(),
  }),
}));

vi.mock("@/components/shared/permission-page", () => ({
  PermissionPage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/app/(main)/he-thong/quan-ly-ban/floor-plan-editor", () => ({
  FloorPlanEditor: () => <div data-testid="so-do-ban" />,
}));

import ModifierFnbPage from "@/app/(main)/hang-hoa/tuy-chon-fnb/page";
import QuanLyBanPage from "@/app/(main)/he-thong/quan-ly-ban/page";

function nhom(
  id: string,
  name: string,
  channel: "fnb" | "retail" | "all" = "fnb",
) {
  return {
    id,
    tenantId: "tn-1",
    name,
    rule: "single" as const,
    channel,
    sortOrder: 1,
    minSelect: 0,
    maxSelect: null,
    isActive: true,
    createdAt: "",
    updatedAt: "",
    optionCount: 2,
  };
}

function ban(id: string, so: string, ten: string, khu: string) {
  return {
    id,
    tableNumber: so,
    name: ten,
    zone: khu,
    capacity: 4,
    status: "available",
    sortOrder: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFnbReadiness.mockResolvedValue(null);
  getBranchSettings.mockResolvedValue({ posZoneOrder: [] });
});

// ══════════════════════════════════════════════════════════════════════
describe("Nhóm tuỳ chọn F&B — tìm theo tên và lọc theo kênh", () => {
  const BA_NHOM = [
    nhom("g-1", "Mức đường", "fnb"),
    nhom("g-2", "Topping trân châu", "fnb"),
    nhom("g-3", "Quy cách đóng gói", "retail"),
  ];

  it("gõ từ khoá: chỉ còn nhóm khớp tên", async () => {
    listModifierGroups.mockResolvedValue(BA_NHOM);
    render(<ModifierFnbPage />);
    await waitFor(() => expect(screen.getByText("Mức đường")).toBeTruthy());

    const o = screen.getByPlaceholderText("Tìm theo tên nhóm tuỳ chọn...");
    fireEvent.change(o, { target: { value: "topping" } });

    // Ô tìm có hoãn 350ms nội bộ nên phải chờ.
    await waitFor(() => expect(screen.queryByText("Mức đường")).toBeNull(), {
      timeout: 2000,
    });
    expect(screen.getByText("Topping trân châu")).toBeTruthy();
  });

  it("lọc kênh Bán lẻ: ẩn nhóm F&B, giữ nhóm bán lẻ", async () => {
    listModifierGroups.mockResolvedValue(BA_NHOM);
    render(<ModifierFnbPage />);
    await waitFor(() => expect(screen.getByText("Mức đường")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Bán lẻ" }));

    await waitFor(() => expect(screen.queryByText("Mức đường")).toBeNull());
    expect(screen.getByText("Quy cách đóng gói")).toBeTruthy();
    expect(screen.getByText("1/3 nhóm")).toBeTruthy();
  });

  it("không khớp: báo ĐÚNG là không khớp bộ lọc, KHÔNG nói chưa có dữ liệu", async () => {
    listModifierGroups.mockResolvedValue(BA_NHOM);
    render(<ModifierFnbPage />);
    await waitFor(() => expect(screen.getByText("Mức đường")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Tìm theo tên nhóm tuỳ chọn..."), {
      target: { value: "không có nhóm nào tên như vầy" },
    });

    await waitFor(
      () => expect(screen.getByText("Không có nhóm nào khớp bộ lọc")).toBeTruthy(),
      { timeout: 2000 },
    );
    // Đây là điểm mấu chốt: KHÔNG được nói "Chưa có nhóm tuỳ chọn nào".
    expect(screen.queryByText("Chưa có nhóm tuỳ chọn nào")).toBeNull();
    expect(screen.getByText(/Đang có 3 nhóm/)).toBeTruthy();
  });

  it("bấm Xoá bộ lọc: danh sách trở lại đủ", async () => {
    listModifierGroups.mockResolvedValue(BA_NHOM);
    render(<ModifierFnbPage />);
    await waitFor(() => expect(screen.getByText("Mức đường")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Bán lẻ" }));
    await waitFor(() => expect(screen.queryByText("Mức đường")).toBeNull());

    fireEvent.click(screen.getAllByText("Xoá bộ lọc")[0]);

    await waitFor(() => expect(screen.getByText("Mức đường")).toBeTruthy());
    expect(screen.getByText("Topping trân châu")).toBeTruthy();
    expect(screen.getByText("Quy cách đóng gói")).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════
describe("Quản lý bàn — tìm bàn theo số, tên hoặc khu vực", () => {
  const BAN = [
    ban("b-1", "01", "Bàn cửa sổ", "Tầng Trệt"),
    ban("b-2", "02", "Bàn dài", "Tầng Trệt"),
    ban("b-3", "11", "Bàn góc", "Sân Vườn"),
  ];

  it("gõ tên khu: giữ nguyên cả khu đó, ẩn khu khác", async () => {
    getTablesByBranch.mockResolvedValue(BAN);
    render(<QuanLyBanPage />);
    await waitFor(() => expect(screen.getByText("Sân Vườn")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Tìm bàn"), {
      target: { value: "sân vườn" },
    });

    await waitFor(() => expect(screen.queryByText("Tầng Trệt")).toBeNull());
    expect(screen.getByText("Sân Vườn")).toBeTruthy();
    expect(screen.getByText("1/3 bàn")).toBeTruthy();
  });

  it("gõ số bàn: chỉ còn bàn khớp", async () => {
    getTablesByBranch.mockResolvedValue(BAN);
    render(<QuanLyBanPage />);
    await waitFor(() => expect(screen.getByText("Bàn cửa sổ")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Tìm bàn"), {
      target: { value: "11" },
    });

    await waitFor(() => expect(screen.queryByText("Bàn cửa sổ")).toBeNull());
    expect(screen.getByText("Bàn góc")).toBeTruthy();
  });

  it("không khớp: nói rõ không khớp, KHÔNG nói chưa có khu vực nào", async () => {
    getTablesByBranch.mockResolvedValue(BAN);
    render(<QuanLyBanPage />);
    await waitFor(() => expect(screen.getByText("Bàn cửa sổ")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Tìm bàn"), {
      target: { value: "zzz" },
    });

    await waitFor(() =>
      expect(screen.getByText("Không có bàn nào khớp")).toBeTruthy(),
    );
    expect(screen.queryByText("Chưa có khu vực nào")).toBeNull();

    fireEvent.click(screen.getAllByText("Xoá tìm kiếm")[0]);
    await waitFor(() => expect(screen.getByText("Bàn cửa sổ")).toBeTruthy());
  });
});
