import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportDateRangePicker } from "@/components/shared/report/report-date-range-picker";
import { DATE_PRESETS } from "@/lib/utils/date-presets";

afterEach(cleanup);

const range = { from: "2026-01-01", to: "2026-01-18" };

function setup() {
  const onPresetChange = vi.fn();
  const onCustomRangeChange = vi.fn();
  const props = { preset: "custom" as const, range, onPresetChange, onCustomRangeChange };
  const view = render(<ReportDateRangePicker {...props} />);
  return { ...view, props, onPresetChange, onCustomRangeChange };
}

async function open() {
  fireEvent.click(screen.getByRole("button", { name: /Tùy chỉnh/ }));
  await screen.findByLabelText("Từ ngày");
}

async function expectClosed() {
  await waitFor(() => expect(screen.queryByLabelText("Từ ngày")).not.toBeInTheDocument());
}

describe("report period picker", () => {
  it("preserves all quick periods and separates scrolling presets from fixed date controls", async () => {
    setup();
    await open();
    for (const preset of DATE_PRESETS) {
      expect(screen.getByRole("button", { name: preset.label })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: "Kỳ nhanh" })).toHaveClass("min-h-0", "overflow-y-auto");
    expect(screen.getByRole("group", { name: "Khoảng ngày tùy chỉnh" })).toHaveClass("shrink-0");
    expect(screen.getByLabelText("Từ ngày")).toHaveValue(range.from);
    expect(screen.getByLabelText("Đến ngày")).toHaveValue(range.to);
  });

  it("selects a quick period once and closes so results are visible", async () => {
    const { onPresetChange, onCustomRangeChange } = setup();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Hôm nay" }));
    expect(onPresetChange).toHaveBeenCalledExactlyOnceWith("today");
    expect(onCustomRangeChange).not.toHaveBeenCalled();
    await expectClosed();
  });

  it("applies the exact custom range and closes", async () => {
    const { onCustomRangeChange, onPresetChange } = setup();
    await open();
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-01-02" } });
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-01-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(onCustomRangeChange).toHaveBeenCalledExactlyOnceWith({ from: "2026-01-02", to: "2026-01-03" });
    expect(onPresetChange).not.toHaveBeenCalled();
    await expectClosed();
  });

  it.each(["", "2026-01-20"])("rejects missing or reversed dates without applying %s", async (from) => {
    const { onCustomRangeChange } = setup();
    await open();
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: from } });
    expect(screen.getByRole("button", { name: "Áp dụng" })).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(onCustomRangeChange).not.toHaveBeenCalled();
  });

  it("discards only unapplied date edits when closed and reloads the current range", async () => {
    const { rerender, props, onCustomRangeChange } = setup();
    await open();
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-01-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Đóng bộ chọn thời gian" }));
    await expectClosed();
    expect(onCustomRangeChange).not.toHaveBeenCalled();
    rerender(<ReportDateRangePicker {...props} range={{ from: "2026-02-01", to: "2026-02-05" }} />);
    await open();
    expect(screen.getByLabelText("Từ ngày")).toHaveValue("2026-02-01");
    expect(screen.getByLabelText("Đến ngày")).toHaveValue("2026-02-05");
  });

  it("closes with Escape without applying a draft", async () => {
    const { onCustomRangeChange } = setup();
    await open();
    fireEvent.keyDown(screen.getByLabelText("Từ ngày"), { key: "Escape" });
    await expectClosed();
    expect(onCustomRangeChange).not.toHaveBeenCalled();
  });
});
