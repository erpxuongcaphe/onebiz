"use client";

import { useId } from "react";
import { useSettings } from "@/lib/contexts/settings-context";
import { Icon } from "@/components/ui/icon";

export function KitchenPrintToggle() {
  const id = useId();
  const { settings, updateSettings } = useSettings();

  return (
    <label
      htmlFor={id}
      className="flex min-h-11 items-center gap-3 px-3 py-2.5 text-sm text-on-surface-variant"
      title="In đơn mới và món bổ sung trên máy này"
    >
      <Icon name="print" size={18} />
      <span className="min-w-0 flex-1 font-medium">Tự động in bếp</span>
      <input
        id={id}
        type="checkbox"
        checked={settings.print.autoPrintKitchen}
        onChange={(event) => updateSettings("print", { autoPrintKitchen: event.target.checked })}
        className="h-4 w-4 shrink-0 accent-primary"
      />
    </label>
  );
}
