import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ load: vi.fn(), staff: vi.fn(), permission: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ branches: [{ id: "a", name: "Quán A" }, { id: "b", name: "Quán B" }], currentBranch: { id: "a" }, user: { id: "user" } }),
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/permissions", () => ({ usePermissions: () => ({ hasPermissionAtBranch: mocks.permission }) }));
vi.mock("@/lib/hooks/use-unsaved-work", () => ({ requestPageLeave: (work: () => void) => work(), useUnsavedWork: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-delivery-staff", () => ({ listFnbDeliveryStaff: mocks.staff }));
vi.mock("@/lib/services/supabase/kitchen-orders", () => ({ assignDeliveryStaff: vi.fn(), unassignDeliveryStaff: vi.fn(), completeDelivery: vi.fn() }));
vi.mock("@/lib/services/supabase/fnb-delivery-dispatch", () => ({ getDeliveryDispatch: mocks.load, saveDeliveryDestination: vi.fn() }));

import { FnbDeliveryDispatch } from "@/components/shared/fnb-delivery-dispatch";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("delivery permissions", () => {
  it("checks the branch selected in the delivery screen", async () => {
    mocks.load.mockResolvedValue([]);
    mocks.staff.mockResolvedValue([]);
    mocks.permission.mockImplementation((_code: string, branch: string | null) => branch === "b");
    render(<FnbDeliveryDispatch />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(mocks.staff).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Chi nhánh giao hàng"), { target: { value: "b" } });
    await waitFor(() => expect(mocks.staff).toHaveBeenCalledWith("b"));
    expect(mocks.permission).toHaveBeenCalledWith("pos_fnb.send_kitchen", "b");
  });
});
