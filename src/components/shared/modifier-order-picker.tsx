"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { moveModifierId, orderedModifierIds, type ModifierOrderMode } from "@/lib/modifier-display-order";

interface Props {
  groups: { id: string; name: string; sortOrder: number }[];
  selectedIds: Set<string>;
  mode: ModifierOrderMode;
  onModeChange: (mode: ModifierOrderMode) => void;
  onOrderChange: (ids: Set<string>) => void;
  disabled?: boolean;
}

export function ModifierOrderPicker({ groups, selectedIds, mode, onModeChange, onOrderChange, disabled }: Props) {
  const ids = orderedModifierIds(groups, selectedIds, mode);
  const names = new Map(groups.map(group => [group.id, group.name]));
  return (
    <div className="space-y-2 border-t pt-3" role="group" aria-label="Thứ tự nhóm tùy chọn trong món">
      <p className="text-sm font-semibold text-primary">Thứ tự hiển thị trên POS</p>
      <div className="flex flex-wrap gap-2">
        {([['common', 'Theo thứ tự chung'], ['custom', 'Thứ tự riêng']] as const).map(([value, label]) => (
          <Button key={value} type="button" variant={mode === value ? 'default' : 'outline'}
            disabled={disabled} aria-pressed={mode === value} onClick={() => {
              if (value === 'custom' && mode === 'common') onOrderChange(new Set(ids));
              onModeChange(value);
            }}>{label}</Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === 'common' ? 'Tự đồng bộ khi thay đổi thứ tự tại Tuỳ chọn món FnB.' : 'Chỉ dùng thứ tự này cho phạm vi đang chỉnh. Nút lên/xuống đổi vị trí nhóm.'}
        {' '}Chỉ áp dụng sau khi lưu. Giá và mặc định chọn giữ nguyên.
      </p>
      <ol className="divide-y rounded-md border bg-background" aria-label="Xem trước thứ tự tùy chọn">
        {ids.map((id, index) => (
          <li key={id} className="flex items-center gap-2 px-3 py-1">
            <span className="w-5 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 text-sm font-medium">{names.get(id) ?? 'Nhóm không còn khả dụng'}</span>
            {mode === 'custom' && <>
              <Button type="button" variant="ghost" className="size-11 p-0" disabled={disabled || index === 0}
                aria-label={`Đưa ${names.get(id) ?? 'nhóm'} lên`} onClick={() => onOrderChange(new Set(moveModifierId(ids, id, -1)))}><Icon name="arrow_upward" size={18} /></Button>
              <Button type="button" variant="ghost" className="size-11 p-0" disabled={disabled || index === ids.length - 1}
                aria-label={`Đưa ${names.get(id) ?? 'nhóm'} xuống`} onClick={() => onOrderChange(new Set(moveModifierId(ids, id, 1)))}><Icon name="arrow_downward" size={18} /></Button>
            </>}
          </li>
        ))}
      </ol>
      {ids.length === 0 && <p className="text-xs text-muted-foreground">Chọn nhóm tùy chọn để xem trước.</p>}
    </div>
  );
}
