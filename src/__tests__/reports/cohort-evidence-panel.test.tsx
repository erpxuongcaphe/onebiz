import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ export: vi.fn() }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: fake.export }));
vi.mock("@/components/shared/report", () => ({ ReportTableFrame: ({ children }: { children: ReactNode }) => children }));
import { CustomerCohortEvidencePanel } from "@/components/reports/customer-cohort-evidence-panel";
import { cohortEvidenceFixture } from "../fixtures/cohort-evidence";
const props = { actorId: "actor-fixture", tenantId: "tenant-fixture", branchId: "branch-fixture", branchLabel: "Chi nhánh mẫu", allowed: true, canExport: true };
beforeEach(() => { fake.export.mockReset(); fake.export.mockResolvedValue(undefined); });
afterEach(cleanup);
it("loads a complete matrix and exports the same source and period", async () => {
  const load = vi.fn().mockResolvedValue(cohortEvidenceFixture()); render(<CustomerCohortEvidencePanel {...props} load={load} />);
  await screen.findByText("60%"); expect(screen.getByRole("table")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" })); await waitFor(() => expect(fake.export).toHaveBeenCalledOnce());
  const options = fake.export.mock.calls[0][0]; expect(options.range).toEqual({ from: "2026-05-01", to: "2026-10-31" });
  expect(options.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(["Độ phủ", "Khách quay lại", "Kỳ quan sát"]);
  expect(options.shouldSave()).toBe(true); expect(load).toHaveBeenCalledWith({ actorId: props.actorId, tenantId: props.tenantId, branchId: props.branchId, months: 6 });
});
it("invalidates the old table and export guard immediately on branch change", async () => {
  let resolve: (value: unknown) => void = () => {};
  const load = vi.fn().mockResolvedValueOnce(cohortEvidenceFixture()).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<CustomerCohortEvidencePanel {...props} load={load} />); await screen.findByText("60%");
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" })); await waitFor(() => expect(fake.export).toHaveBeenCalledOnce());
  const guard = fake.export.mock.calls[0][0].shouldSave;
  view.rerender(<CustomerCohortEvidencePanel {...props} branchId="branch-new" load={load} />);
  expect(guard()).toBe(false); expect(screen.queryByRole("table")).toBeNull(); expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeDisabled();
  await act(async () => resolve(cohortEvidenceFixture(6, "branch-new"))); await screen.findByText("60%");
});
it("fails closed on malformed scope and retries the current scope", async () => {
  const load = vi.fn().mockResolvedValueOnce(cohortEvidenceFixture(6, "foreign")).mockResolvedValueOnce(cohortEvidenceFixture());
  render(<CustomerCohortEvidencePanel {...props} load={load} />); await screen.findByRole("alert");
  expect(screen.queryByRole("table")).toBeNull(); expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Tải lại" })); await screen.findByText("60%"); expect(load).toHaveBeenCalledTimes(2);
});
it("does not show an analytical matrix when source dates are incomplete", async () => {
  const raw = cohortEvidenceFixture(); raw.retention_ready = false; raw.coverage.invalid_date_records = 1;
  const load = vi.fn().mockResolvedValue(raw); render(<CustomerCohortEvidencePanel {...props} load={load} />);
  await screen.findByRole("alert"); expect(screen.queryByRole("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" })); await waitFor(() => expect(fake.export).toHaveBeenCalledOnce());
  expect(fake.export.mock.calls[0][0].sheets[1].rows.every((row: { size: unknown; m0: unknown }) => row.size === null && row.m0 === null)).toBe(true);
});
it("removes all data and invalidates a pending export when permission is revoked", async () => {
  const load = vi.fn().mockResolvedValue(cohortEvidenceFixture()); const view = render(<CustomerCohortEvidencePanel {...props} load={load} />);
  await screen.findByText("60%"); fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" })); await waitFor(() => expect(fake.export).toHaveBeenCalledOnce());
  const guard = fake.export.mock.calls[0][0].shouldSave; view.rerender(<CustomerCohortEvidencePanel {...props} allowed={false} load={load} />);
  expect(guard()).toBe(false); expect(screen.queryByText("60%")).toBeNull(); expect(screen.queryByRole("table")).toBeNull();
});
it("hides the export action when export permission is absent", async () => {
  render(<CustomerCohortEvidencePanel {...props} canExport={false} load={vi.fn().mockResolvedValue(cohortEvidenceFixture())} />);
  await screen.findByText("60%"); expect(screen.queryByRole("button", { name: "Excel đầy đủ" })).toBeNull();
});
it("keeps completed-invoice analysis available while separately warning about missing legacy audit traces", async () => {
  const raw = cohortEvidenceFixture(); raw.coverage.historical_legacy_trace_gaps = 16;
  const view = render(<CustomerCohortEvidencePanel {...props} load={vi.fn().mockResolvedValue(raw)} />);
  await screen.findByText(/Đã giữ theo trạng thái/); expect(screen.getByRole("table")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" })); await waitFor(() => expect(fake.export).toHaveBeenCalledOnce());
  const guard = fake.export.mock.calls[0][0].shouldSave; view.unmount(); expect(guard()).toBe(false);
});
it("does not expose raw server diagnostics in a source error", async () => {
  render(<CustomerCohortEvidencePanel {...props} load={vi.fn().mockRejectedValue(new Error("PRIVATE_SQL_DIAGNOSTIC"))} />);
  await screen.findByRole("alert"); expect(screen.queryByText(/PRIVATE_SQL_DIAGNOSTIC/)).toBeNull();
  expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeDisabled();
});
