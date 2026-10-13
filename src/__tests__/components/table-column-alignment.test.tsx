import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { resolveTableColumnAlignment } from "@/lib/table-column-alignment";
import { DataTable } from "@/components/shared/data-table";
import { DetailItemsTable } from "@/components/shared/inline-detail-panel/detail-items-table";
import { ReportDataTable } from "@/components/shared/report/report-data-table";

vi.mock("next/navigation", () => ({ usePathname: () => "/alignment-test" }));

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

describe("shared column alignment", () => {
  it("respects explicit alignment and does not guess numbers from codes or formatted strings", () => {
    expect(resolveTableColumnAlignment(undefined, "amount", [null, 0, -25])).toBe("right");
    expect(resolveTableColumnAlignment(undefined, "amount", [0, "pending"])).toBe("left");
    expect(resolveTableColumnAlignment(undefined, "code", [12345])).toBe("left");
    expect(resolveTableColumnAlignment(undefined, "supplierId", [42])).toBe("left");
    expect(resolveTableColumnAlignment(undefined, "phoneNumber", [123456])).toBe("left");
    expect(resolveTableColumnAlignment(undefined, "amount", ["12,345"])).toBe("left");
    expect(resolveTableColumnAlignment("right", "amount", [])).toBe("right");
    expect(resolveTableColumnAlignment("center", "count", [10])).toBe("center");
  });

  it("aligns a list heading, source number, and summary on the same edge", () => {
    type Row = { name: string; amount: number; barcode: number; status: string };
    const columns: ColumnDef<Row>[] = [
      { accessorKey: "name", header: "Tên" },
      { accessorKey: "amount", header: "Số tiền", cell: ({ getValue }) => Number(getValue()).toLocaleString("en-US") },
      { accessorKey: "barcode", header: "Mã" },
      { accessorKey: "status", header: "Trạng thái", meta: { align: "center" } },
    ];
    const { rerender } = render(<DataTable columns={columns} data={[{ name: "Phiếu A", amount: 123000, barcode: 12345, status: "Xong" }]} summaryRow={{ amount: "Tổng 123,000" }} />);
    const heading = screen.getByRole("columnheader", { name: /Số tiền/ });
    expect(heading).toHaveClass("text-right");
    expect(heading.querySelector("div")).toHaveClass("justify-end");
    expect(heading.querySelector("span")).toHaveClass("order-first");
    expect(screen.getByRole("cell", { name: "123,000" })).toHaveClass("text-right", "tabular-nums");
    expect(screen.getByText("Tổng 123,000").closest("td")).toHaveClass("text-right");
    expect(screen.getByRole("columnheader", { name: /^Mã/ })).toHaveClass("text-left");
    expect(screen.getByRole("columnheader", { name: /Trạng thái/ })).toHaveClass("text-center");
    // Numeric metadata keeps the same heading alignment during loading/empty states.
    rerender(<DataTable columns={columns.map(c => "accessorKey" in c && c.accessorKey === "amount" ? { ...c, meta: { align: "right" } } : c)} data={[]} loading />);
    expect(screen.getByRole("columnheader", { name: /Số tiền/ })).toHaveClass("text-right");
  });

  it("uses the same numeric policy in inline detail tables", () => {
    render(<DetailItemsTable columns={[{ header: "Tên", accessor: "name" }, { header: "SL", accessor: "quantity" }]} items={[{ name: "Món A", quantity: 0 }]} />);
    expect(screen.getByRole("columnheader", { name: "SL" })).toHaveClass("text-right");
    expect(screen.getByText("0").closest("td")).toHaveClass("text-right", "tabular-nums");
    expect(screen.getByRole("columnheader", { name: "Tên" })).toHaveClass("text-left");
  });

  it("keeps report source values and subtotals aligned, including sortable headings", () => {
    render(<ReportDataTable columns={[{ key: "name", label: "Tên" }, { key: "amount", label: "Tiền", subtotalCell: "Tổng 40" }]} rows={[{ name: "Nhóm A", amount: 40 }]} getRowKey={row => row.name} subtotalLabel="Tổng" showDisplayOptions={false} />);
    const heading = screen.getByRole("columnheader", { name: /Tiền/ });
    expect(heading).toHaveClass("text-right");
    expect(within(heading).getByRole("button").querySelector("span")).toHaveClass("order-first");
    expect(screen.getByText("40").closest("td")).toHaveClass("text-right");
    expect(screen.getByText("Tổng 40").closest("td")).toHaveClass("text-right");
  });
});
