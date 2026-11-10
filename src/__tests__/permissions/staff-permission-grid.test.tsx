import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StaffPermissionGrid } from "@/components/shared/staff-permission-grid";
it("finds Vietnamese rights without accents and preserves hidden rights when editing", () => {
 const change=vi.fn();
 render(<StaffPermissionGrid permissions={["system.create_user","inventory.view"]} onChange={change} />);
 fireEvent.change(screen.getByLabelText("Tìm quyền"),{target:{value:"xem ton kho"}});
 expect(screen.getByLabelText("Xem tồn kho")).toBeChecked();
 fireEvent.click(screen.getByLabelText("Xem tồn kho"));
 expect(change).toHaveBeenCalledWith(["system.create_user"]);
});
