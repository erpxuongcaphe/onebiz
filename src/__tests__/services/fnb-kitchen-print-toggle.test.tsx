import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsProvider } from "@/lib/contexts/settings-context";
import { KitchenPrintToggle } from "@/app/pos/fnb/components/kitchen-print-toggle";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

describe("F&B kitchen auto-print control", () => {
  it("persists off/on using the existing setting and retains other print options", async () => {
    localStorage.setItem("onebiz_settings", JSON.stringify({ print: {
      autoPrintKitchen: true, autoPrintReceipt: true, paperSize: "58mm",
    } }));
    const view = render(<SettingsProvider><KitchenPrintToggle /></SettingsProvider>);
    const toggle = screen.getByRole("checkbox", { name: "Tự động in bếp" });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(JSON.parse(localStorage.getItem("onebiz_settings")!).print)
      .toMatchObject({ autoPrintKitchen: false, autoPrintReceipt: true, paperSize: "58mm" }));
    view.unmount();
    render(<SettingsProvider><KitchenPrintToggle /></SettingsProvider>);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("onebiz_settings")!).print.autoPrintKitchen)
      .toBe(true));
  });
});
