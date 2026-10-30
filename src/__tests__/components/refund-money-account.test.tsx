import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ accounts: vi.fn() }));
vi.mock("@/lib/services/supabase/money-accounts", async original => ({...await original<typeof import("@/lib/services/supabase/money-accounts")>(), getMoneyAccounts: mocks.accounts}));
import { MoneyAccountSelect } from "@/components/shared/money-account-select";
const props = {branchId: "branch", method: "transfer", value: "", onChange: vi.fn(), label: "Quỹ / tài khoản nhận tiền", emptyHint: "Thêm tài khoản nhận thực tế trước khi ghi phiếu thu."};
beforeEach(() => {vi.clearAllMocks(); mocks.accounts.mockResolvedValue([]);});afterEach(cleanup);
it("explains missing receiving accounts and reloads after account setup without reloading the page", async () => {
 const view=render(<MoneyAccountSelect {...props}/>);
 expect(await screen.findByText(props.emptyHint)).toBeInTheDocument();
 mocks.accounts.mockResolvedValue([{id: "bank", code: "BANK", name: "Ngân hàng công ty", kind: "bank", active: true, account_number: "123"}]);
 view.rerender(<MoneyAccountSelect {...props} refreshKey={1}/>);
 expect(await screen.findByRole("option", {name: /BANK · Ngân hàng công ty/})).toBeInTheDocument();
 expect(screen.getByLabelText(props.label)).toHaveValue("");
 expect(mocks.accounts).toHaveBeenCalledTimes(2);
});
it("offers only accounts matching the receiving method and never hides load errors as an empty balance", async () => {
 mocks.accounts.mockResolvedValue([{id: "cash",code: "CASH",name: "Quỹ",kind: "cash",active: true},{id: "closed",code: "OLD",name: "Cũ",kind: "bank",active: false}]);
 const view=render(<MoneyAccountSelect {...props}/>);
 expect(await screen.findByText(props.emptyHint)).toBeInTheDocument();
 expect(screen.queryByRole("option", {name: /CASH|OLD/})).not.toBeInTheDocument();
 mocks.accounts.mockRejectedValue(new Error("Không tải được tài khoản"));
 view.rerender(<MoneyAccountSelect {...props} refreshKey={1}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được tài khoản");
 expect(screen.queryByText(props.emptyHint)).not.toBeInTheDocument();
});
