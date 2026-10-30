import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  zones: vi.fn(), tables: vi.fn(), decorations: vi.fn(),
  deleteDecoration: vi.fn(), deleteZone: vi.fn(), deleteTable: vi.fn(), updateTable: vi.fn(), toast: vi.fn(), canManage: vi.fn(),
  unassigned: vi.fn(), createZone: vi.fn(), updateLayout: vi.fn(), createTable: vi.fn(),
}));
vi.mock("@/lib/services/supabase/floor-plan", () => ({getUnassignedFloorPlanTables:mocks.unassigned,reorderFloorPlanZones:vi.fn()}));
vi.mock("@/lib/services", () => ({
  getFloorPlanZones: mocks.zones, getTablesByZone: mocks.tables,
  getTablesByBranch: vi.fn(), createFloorPlanZone: mocks.createZone,
  updateFloorPlanZone: vi.fn(), deleteFloorPlanZone: mocks.deleteZone,
  updateTableLayout: mocks.updateLayout, createTable: mocks.createTable, updateTable: mocks.updateTable, deleteTable: mocks.deleteTable,
}));
vi.mock("@/lib/services/supabase/floor-plan-decorations", () => ({
  getDecorationsByZone: mocks.decorations, deleteDecoration: mocks.deleteDecoration,
  createDecoration: vi.fn(), updateDecoration: vi.fn(),
  uploadFloorPlanBackground: vi.fn(), removeFloorPlanBackground: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ tenant: { id: "tenant" }, hasPermission: mocks.canManage }) }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("next/dynamic", () => ({ default: () => function Canvas(props: {
  tables: Array<{ id: string; name: string }>;
  decorations: Array<{ id: string; label: string }>;
  onSelectedDecorationIdChange: (id: string) => void;
  onSelectedTableIdChange: (id: string) => void;
}) {
  return <div>
    {props.tables.map(table => <span key={table.id}>{table.name}</span>)}
    {props.tables.map(table => <button key={`select-${table.id}`} aria-label={`Chọn ${table.name}`}
      onClick={() => props.onSelectedTableIdChange(table.id)}>Chọn bàn</button>)}
    {props.decorations.map(decor => <button key={decor.id}
      onClick={() => props.onSelectedDecorationIdChange(decor.id)}>Chọn {decor.label}</button>)}
  </div>;
} }));

import { FloorPlanEditor } from "@/components/shared/floor-plan/floor-plan-editor";

async function selectTree() {
  render(<FloorPlanEditor branchId="xtb" branchName="XTB" scope="branch" />);
  fireEvent.click(await screen.findByRole("button", { name: "Chọn Cây cảnh" }, { timeout: 10000 }));
  return screen.getByRole("button", { name: "Xoá vật đang chọn" });
}

describe("floor plan deletion targets", () => {
  beforeEach(() => {
    configure({ asyncUtilTimeout: 10000 });
    vi.clearAllMocks();
    mocks.unassigned.mockResolvedValue([]);
    mocks.updateLayout.mockResolvedValue(undefined);
    mocks.canManage.mockReturnValue(true);
    mocks.zones.mockResolvedValue([{ id: "inside", name: "Trong Nhà", canvasWidth: 1000,
      canvasHeight: 700, gridSize: 16, floorLevel: 0, backgroundOpacity: 100 }]);
    mocks.tables.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ id: `table-${i}`, name: `Bàn ${i + 1}`, tableNumber: i + 1 })));
    mocks.decorations.mockResolvedValue([{ id: "tree-1", label: "Cây cảnh", type: "plant",
      width: 50, height: 50, positionX: 0, positionY: 0, rotation: 0 }]);
    mocks.deleteDecoration.mockResolvedValue(undefined);
    mocks.deleteTable.mockResolvedValue(undefined);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("confirm", vi.fn(() => false));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); configure({ asyncUtilTimeout: 1000 }); });

  it("deletes only the selected decoration and retains all tables", async () => {
    fireEvent.click(await selectTree());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Chọn Cây cảnh" })).not.toBeInTheDocument());
    expect(mocks.deleteDecoration).toHaveBeenCalledExactlyOnceWith("tree-1");
    expect(mocks.deleteZone).not.toHaveBeenCalled();
    for (let i = 1; i <= 9; i++) expect(screen.getAllByText(`Bàn ${i}`).length).toBeGreaterThan(0);
  });

  it("retains the tree and selection if saving fails", async () => {
    mocks.deleteDecoration.mockRejectedValueOnce(new Error("Save failed"));
    fireEvent.click(await selectTree());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Không xoá được vật trang trí" })));
    expect(screen.getByRole("button", { name: "Chọn Cây cảnh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xoá vật đang chọn" })).toBeEnabled();
    expect(mocks.deleteZone).not.toHaveBeenCalled();
  });

  it("does not submit repeated deletion while the request is pending", async () => {
    let resolve!: () => void;
    mocks.deleteDecoration.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const button = await selectTree();
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.deleteDecoration).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });

  it("labels zone deletion separately and retains its confirmation", async () => {
    await selectTree();
    fireEvent.click(screen.getByRole("button", { name: "Xoá khu vực Trong Nhà" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Xoá khu vực "Trong Nhà"'));
    expect(mocks.deleteZone).not.toHaveBeenCalled();
    expect(mocks.deleteDecoration).not.toHaveBeenCalled();
  });

  it("persists table number and name using the original table and branch IDs", async () => {
    mocks.updateTable.mockResolvedValue({ tableNumber: 19, name: "Bàn cửa sổ" });
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    fireEvent.change(screen.getByLabelText("Số thứ tự nội bộ"), { target: { value: "19" } });
    fireEvent.change(screen.getByLabelText("Tên / mã bàn"), { target: { value: "Bàn cửa sổ" } });
    expect(mocks.updateTable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thông tin bàn" }));
    await waitFor(() => expect(screen.getAllByText("Bàn cửa sổ").length).toBeGreaterThan(0));
    expect(mocks.updateTable).toHaveBeenCalledExactlyOnceWith("xtb", "table-0", { tableNumber: 19, name: "Bàn cửa sổ" });
    expect(screen.getByLabelText("Số thứ tự nội bộ")).toHaveValue(19);
    expect(mocks.deleteZone).not.toHaveBeenCalled();
  });

  it("keeps the saved table intact and draft editable on duplicate-number rejection", async () => {
    mocks.updateTable.mockRejectedValueOnce(new Error("Số bàn 2 đã tồn tại trong chi nhánh."));
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    fireEvent.change(screen.getByLabelText("Số thứ tự nội bộ"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thông tin bàn" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Không lưu được thông tin bàn", description: "Số bàn 2 đã tồn tại trong chi nhánh.",
    })));
    expect(screen.getAllByText("Bàn 1").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Lưu thông tin bàn" })).toBeEnabled();
  });

  it("rejects invalid numbers without calling the server", async () => {
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    for (const number of ["", "0", "1.5", "10000"]) {
      fireEvent.change(screen.getByLabelText("Số thứ tự nội bộ"), { target: { value: number } });
      fireEvent.click(screen.getByRole("button", { name: "Lưu thông tin bàn" }));
    }
    expect(mocks.updateTable).not.toHaveBeenCalled();
  });

  it("blocks repeat identity saves while awaiting the server", async () => {
    let resolve!: (value: { tableNumber: number; name: string }) => void;
    mocks.updateTable.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    fireEvent.change(screen.getByLabelText("Số thứ tự nội bộ"), { target: { value: "19" } });
    const button = screen.getByRole("button", { name: "Lưu thông tin bàn" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.updateTable).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Số thứ tự nội bộ")).toBeDisabled();
    await act(async () => resolve({ tableNumber: 19, name: "Bàn 1" }));
  });

  it("does not expose identity editing without the existing table-management permission", async () => {
    mocks.canManage.mockReturnValue(false);
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    expect(screen.queryByLabelText("Số thứ tự nội bộ")).not.toBeInTheDocument();
    expect(mocks.updateTable).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Xoá bàn đang chọn" })).not.toBeInTheDocument();
  });

  it("soft-deletes only the confirmed table through the existing branch-scoped service", async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Xoá bàn đang chọn" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Chọn Bàn 1" })).not.toBeInTheDocument());
    expect(mocks.deleteTable).toHaveBeenCalledExactlyOnceWith("xtb", "table-0");
    expect(mocks.deleteZone).not.toHaveBeenCalled();
    expect(mocks.deleteDecoration).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Chọn Bàn 2" })).toBeInTheDocument();
  });

  it("retains the table on cancellation or an active-order rejection", async () => {
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Xoá bàn đang chọn" }));
    expect(mocks.deleteTable).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    mocks.deleteTable.mockRejectedValueOnce(new Error("Bàn còn đơn đang phục vụ"));
    fireEvent.click(screen.getByRole("button", { name: "Xoá bàn đang chọn" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Không xoá được bàn" })));
    expect(screen.getByRole("button", { name: "Chọn Bàn 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xoá bàn đang chọn" })).toBeEnabled();
  });

  it("submits table deletion once while pending", async () => {
    let resolve!: () => void;
    mocks.deleteTable.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    vi.mocked(window.confirm).mockReturnValue(true);
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    const button = screen.getByRole("button", { name: "Xoá bàn đang chọn" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.deleteTable).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => resolve());
  });

  it("clears table selection when a decoration is selected", async () => {
    render(<FloorPlanEditor branchId="xtb" scope="branch" />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn Bàn 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Chọn Cây cảnh" }));
    expect(screen.queryByLabelText("Số thứ tự nội bộ")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xoá bàn đang chọn" })).not.toBeInTheDocument();
  });

  it("places decoration properties first and keeps desktop tools unconstrained", async () => {
    await selectTree();
    const tools = document.getElementById("floor-plan-tools")!;
    expect(tools.firstElementChild).toHaveTextContent("Vật đang chọn");
    expect(tools.className).toContain("lg:max-h-none");
    expect(screen.getByLabelText("Tên hiển thị")).toHaveValue("Cây cảnh");
  });

  it("opens an empty plan without recreating a deleted zone or altering existing tables", async () => {
    mocks.zones.mockResolvedValue([]);
    mocks.unassigned.mockResolvedValue([{id:'dx-01',zoneId:null,name:'ĐX 01',tableNumber:1,width:80,height:80}]);
    render(<FloorPlanEditor branchId="dong-xoai" branchName="Đồng Xoài" scope="global" />);
    expect(await screen.findByRole('heading',{name:'Chưa có khu sơ đồ'})).toBeVisible();
    expect(screen.getByLabelText('Các bàn có sẵn chưa xếp khu')).toHaveTextContent('ĐX 01');
    expect(screen.queryByLabelText('Đang tải sơ đồ')).not.toBeInTheDocument();
    expect(mocks.createZone).not.toHaveBeenCalled();
    expect(mocks.updateLayout).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Chưa có thao tác chỉnh sửa');
  });

  it("creates a zone only on request, then assigns the original table ID without creating another table", async () => {
    mocks.zones.mockResolvedValue([]);
    mocks.tables.mockResolvedValue([]);
    const table={id:'dx-01',zoneId:null,name:'ĐX 01',tableNumber:1,width:80,height:80,status:'available',positionX:0,positionY:0};
    mocks.unassigned.mockResolvedValue([table]);
    mocks.createZone.mockResolvedValue({id:'new-zone',name:'Trong nhà mới',canvasWidth:1024,canvasHeight:720,floorLevel:1,gridSize:16});
    vi.stubGlobal('prompt',vi.fn(()=>'Trong nhà mới'));
    render(<FloorPlanEditor branchId="dong-xoai" scope="global" />);
    fireEvent.click(await screen.findByRole('button',{name:'Tạo khu vực mới'}));
    await waitFor(()=>expect(mocks.createZone).toHaveBeenCalledExactlyOnceWith({branchId:'dong-xoai',name:'Trong nhà mới'}));
    const existing=await screen.findByRole('button',{name:'ĐX 01'});
    await waitFor(()=>expect(existing).toBeEnabled());
    fireEvent.click(existing);
    await waitFor(()=>expect(mocks.updateLayout).toHaveBeenCalledExactlyOnceWith('dx-01',{zoneId:'new-zone',positionX:472,positionY:320}));
    await waitFor(()=>expect(screen.queryByLabelText('Bàn chưa xếp khu')).not.toBeInTheDocument());
    expect(mocks.createTable).not.toHaveBeenCalled();
    expect(table.zoneId).toBeNull();
  });

  it("offers retry for read errors without reporting unsaved edits", async () => {
    mocks.zones.mockRejectedValueOnce(new Error('Mất kết nối đọc khu vực'));
    render(<FloorPlanEditor branchId="dong-xoai" scope="global" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Mất kết nối đọc khu vực');
    expect(screen.getByRole('status')).toHaveTextContent('Chưa có thao tác chỉnh sửa');
    fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
    expect(await screen.findByRole('button',{name:'Chọn Cây cảnh'})).toBeVisible();
    expect(mocks.createZone).not.toHaveBeenCalled();
  });

  it("does not silently replace decorations with an empty layout after a read failure", async () => {
    mocks.decorations.mockRejectedValueOnce(new Error('Không đọc được trang trí'));
    render(<FloorPlanEditor branchId="dong-xoai" scope="global" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được trang trí');
    expect(screen.queryByRole('button',{name:'Chọn Bàn 1'})).not.toBeInTheDocument();
    expect(mocks.updateLayout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
    expect(await screen.findByRole('button',{name:'Chọn Cây cảnh'})).toBeVisible();
  });

  it("stops waiting after a stalled read and does not treat it as a save failure", async () => {
    vi.useFakeTimers();
    mocks.zones.mockReturnValueOnce(new Promise(()=>{}));
    render(<FloorPlanEditor branchId="dong-xoai" scope="global" />);
    expect(screen.getByLabelText('Đang tải sơ đồ')).toBeVisible();
    await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
    expect(screen.getByRole('alert')).toHaveTextContent('Kết nối đang chậm');
    expect(screen.queryByLabelText('Đang tải sơ đồ')).not.toBeInTheDocument();
    expect(mocks.createZone).not.toHaveBeenCalled();
  });

  it("ignores a late branch read when the user has switched branches", async () => {
    let finish!:(zones:unknown[])=>void;
    mocks.zones.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    mocks.zones.mockResolvedValueOnce([]);
    mocks.unassigned.mockResolvedValueOnce([{id:'old-table',name:'Bàn chi nhánh cũ'}]);
    mocks.unassigned.mockResolvedValueOnce([{id:'new-table',name:'Bàn chi nhánh mới'}]);
    const view=render(<FloorPlanEditor branchId="old" scope="global" />);
    view.rerender(<FloorPlanEditor branchId="new" scope="global" />);
    expect(await screen.findByRole('heading',{name:'Chưa có khu sơ đồ'})).toBeVisible();
    await act(async()=>finish([]));
    expect(screen.getByLabelText('Các bàn có sẵn chưa xếp khu')).toHaveTextContent('Bàn chi nhánh mới');
    expect(screen.queryByText('Bàn chi nhánh cũ')).not.toBeInTheDocument();
    expect(mocks.createZone).not.toHaveBeenCalled();
  });

  it("keeps an existing table available for retry after assignment fails and blocks double clicks", async () => {
    let fail!:(error:Error)=>void;
    mocks.unassigned.mockResolvedValue([{id:'dx-01',zoneId:null,name:'ĐX 01',tableNumber:1,width:80,height:80}]);
    mocks.updateLayout.mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;}));
    render(<FloorPlanEditor branchId="dong-xoai" scope="global" />);
    const button=await screen.findByRole('button',{name:'ĐX 01'});
    await waitFor(()=>expect(button).toBeEnabled());
    act(()=>{fireEvent.click(button);fireEvent.click(button);});
    expect(mocks.updateLayout).toHaveBeenCalledTimes(1);
    await act(async()=>fail(new Error('Lưu thất bại')));
    expect(screen.getByRole('button',{name:'ĐX 01'})).toBeEnabled();
    expect(mocks.createTable).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Chưa xếp được bàn'}));
  });
});
