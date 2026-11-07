import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Page from "@/app/(auth)/dang-nhap/page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("redirect=%2Fho-so") }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("sends one request at a time and allows retry after failure", async () => {
  let finish!: (response: unknown) => void;
  const fetch = vi.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Thử lại sau" }) });
  vi.stubGlobal("fetch", fetch);
  render(<Page />);
  fireEvent.change(screen.getByLabelText("Email hoặc số điện thoại"), { target: { value: "fixture@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "fixture-password" } });
  const form = screen.getByRole("button", { name: "Đăng nhập" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/auth/sign-in?redirect=%2Fho-so", expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(screen.getByRole("button", { name: "Đang đăng nhập…" })).toBeDisabled();
  await act(async () => finish({ ok: false, json: async () => ({ error: "Không đăng nhập được" }) }));
  expect(screen.getByRole("alert")).toHaveTextContent("Không đăng nhập được");
  fireEvent.submit(form);
  expect(await screen.findByText("Thử lại sau")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});
