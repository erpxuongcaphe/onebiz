import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KanbanBoard } from "@/components/shared/kanban-board";

afterEach(cleanup);
const columns = [
  { id: "open", label: "Chờ nhận", items: [{ id: "one", code: "PN001" }] },
  { id: "done", label: "Đã nhận", items: [] as { id: string; code: string }[], readOnly: true },
];
const transfer = () => ({ setData: vi.fn(), getData: () => "one", effectAllowed: "", dropEffect: "" });

it("receipt cards open with keyboard without enabling stock-changing drag", () => {
  const open = vi.fn();
  render(<KanbanBoard columns={columns} getItemId={row => row.id} renderCard={row => row.code} onCardClick={open} />);
  const card = screen.getByRole("button", { name: "PN001" });
  expect(card.draggable).toBe(false);
  fireEvent.keyDown(card, { key: "Enter" });
  expect(open).toHaveBeenCalledWith(columns[0].items[0]);
});

it("read-only destinations cannot invoke a transition on a dispatched drop", () => {
  const move = vi.fn();
  render(<KanbanBoard columns={columns} getItemId={row => row.id} renderCard={row => row.code} onCardMove={move} />);
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByText("PN001"), { dataTransfer });
  fireEvent.drop(screen.getByText("Đã nhận").parentElement!.parentElement!, { dataTransfer });
  expect(move).not.toHaveBeenCalled();
});

it("allowed production transitions still invoke the existing workflow callback", () => {
  const move = vi.fn();
  render(<KanbanBoard columns={columns.map(col => ({ ...col, readOnly: false }))} getItemId={row => row.id} renderCard={row => row.code} onCardMove={move} canDrop={(_, from, to) => from === "open" && to === "done"} />);
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByText("PN001"), { dataTransfer });
  fireEvent.drop(screen.getByText("Đã nhận").parentElement!.parentElement!, { dataTransfer });
  expect(move).toHaveBeenCalledWith("one", "open", "done");
});
