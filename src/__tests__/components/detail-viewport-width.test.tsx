import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DataTable } from "@/components/shared/data-table";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens deep-linked desktop detail outside the width of the list table", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: 1366 >= Number(query.match(/min-width: (\d+)/)?.[1] ?? Infinity),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const view = render(<DataTable
    columns={[{ accessorKey: "name", header: "Mã", size: 1500 }]}
    data={[{ name: "Bill A" }]}
    expandedRow={0}
    renderDetail={() => <p>Chi tiết món</p>}
  />);
  const dialog = await screen.findByRole("dialog");
  expect(view.container).not.toContainElement(dialog);
  expect(within(dialog).getByText("Chi tiết món")).toBeInTheDocument();
});
