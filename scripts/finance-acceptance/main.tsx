import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/app/globals.css";
import { SettleDebtDialog } from "@/components/shared/dialogs/settle-debt-dialog";
import { CashAmendmentHistory } from "@/components/shared/cash-amendment-history";
import { FilterPanel } from "@/components/shared/filter-sidebar/filter-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PartyAdvanceLedger } from "@/components/shared/party-advance-ledger";

function App() {
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState(false),
    [query, setQuery] = useState("");
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">
        Nghiệm thu công nợ · Dữ liệu giả lập
      </h1>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setOpen(true)}>Thanh toán / cấn tiền ứng</Button>
        <Button variant="outline" onClick={() => setFilter(true)}>
          Bộ lọc
        </Button>
      </div>
      <CashAmendmentHistory cashId="fixture" canExport />
      <PartyAdvanceLedger mode="supplier" partyId="supplier" partyName="Nhà cung cấp kiểm thử" branchId="branch" canExport canRefund revision={0}/>
      <SettleDebtDialog
        open={open}
        onOpenChange={setOpen}
        mode="supplier"
        partyId="supplier"
        partyName="Nhà cung cấp kiểm thử"
        branchId="branch"
        estimatedDebt={1380000}
      />
      <FilterPanel
        open={filter}
        onOpenChange={setFilter}
        title="Bộ lọc công nợ"
      >
        <label className="space-y-2 text-sm">
          Nội dung
          <Input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </FilterPanel>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
