import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FnbItemDialog, type FnbItemInitialSelection } from '@/app/pos/fnb/components/fnb-item-dialog';
import type { ModifierGroup, ModifierOption } from '@/lib/services/supabase/modifier-groups';

afterEach(cleanup);
const group: ModifierGroup = { id: 'sweet', tenantId: 'tenant', name: 'Mức ngọt', rule: 'single',
  channel: 'fnb', sortOrder: 0, minSelect: 0, maxSelect: null, isActive: true, createdAt: '', updatedAt: '' };
const options: ModifierOption[] = [
  { id: 'normal', groupId: group.id, label: '100% (bình thường)', priceDelta: 0, scaleFactor: 1, linkedProductId: null, isDefault: true, isActive: true, sortOrder: 0 },
  { id: 'less', groupId: group.id, label: '80% (ít đường)', priceDelta: 0, scaleFactor: 0.8, linkedProductId: null, isDefault: false, isActive: true, sortOrder: 1 },
  { id: 'none', groupId: group.id, label: 'Không Đường', priceDelta: 0, scaleFactor: 0, linkedProductId: null, isDefault: false, isActive: true, sortOrder: 2 },
  { id: 'more', groupId: group.id, label: '120% (ngọt)', priceDelta: 0, scaleFactor: 1.2, linkedProductId: null, isDefault: false, isActive: true, sortOrder: 3 },
];
function mount(input: { initial?: FnbItemInitialSelection; configured?: ModifierOption[]; name?: string } = {}) {
  const confirm = vi.fn();
  render(<FnbItemDialog open onOpenChange={vi.fn()} product={{ id: 'coffee', name: 'Cà Phê Tươi (Máy)', sell_price: 42000 }}
    initialSelection={input.initial} dynamicModifiers={{ groups: [{ ...group, name: input.name ?? group.name }],
      optionsByGroup: new Map([[group.id, input.configured ?? options]]) }} onConfirm={confirm} />);
  return confirm;
}
function snapshot(ids: string[]): FnbItemInitialSelection {
  return { modifierSelections: [{ groupId: group.id, groupName: group.name, rule: 'single',
    options: ids.map(id => ({ optionId: id, label: id, priceDelta: 0, scaleFactor: null, linkedProductId: null })) }] };
}

describe('F&B sweetness choice at the point of adding or editing a cart item', () => {
  it.each(['Mức ngọt', 'Mức ngọt - Ô Long', 'Mức đường', 'Muc ngot', 'Độ ngọt'])('keeps the configured default selected on repeated taps: %s', name => {
    const confirm = mount({ name });
    const normal = screen.getByRole('button', { name: '100% (bình thường)' });
    expect(normal).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(normal);
    fireEvent.click(normal);
    expect(normal).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0].modifierSelections[0].options).toEqual([
      expect.objectContaining({ optionId: 'normal', scaleFactor: 1 }),
    ]);
  });
  it.each(['less', 'none', 'more'])('preserves a saved customer choice including zero sugar: %s', id => {
    const confirm = mount({ initial: snapshot([id]) });
    const option = options.find(o => o.id === id)!;
    const selected = screen.getByRole('button', { name: option.label });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(selected);
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(confirm.mock.calls[0][0].modifierSelections[0].options).toEqual([
      expect.objectContaining({ optionId: id, scaleFactor: option.scaleFactor }),
    ]);
    expect(confirm.mock.calls[0][0].unitPrice).toBe(42000);
  });
  it.each(['none', 'more'])('uses the configured default rather than assuming 100 percent: %s', id => {
    const confirm = mount({ configured: options.map(o => ({ ...o, isDefault: o.id === id })) });
    expect(screen.getByRole('button', { name: options.find(o => o.id === id)!.label })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(confirm.mock.calls[0][0].modifierSelections[0].options).toEqual([
      expect.objectContaining({ optionId: id, scaleFactor: id === 'none' ? 0 : 1.2 }),
    ]);
  });
  it.each([{ ids: [] }, { ids: ['normal', 'less'] }, { ids: ['removed-option'] }])('requires correction of an invalid saved snapshot $ids', ({ ids }) => {
    const saved = snapshot(ids);
    const before = JSON.stringify(saved);
    const confirm = mount({ initial: saved });
    const blocked = screen.getByRole('button', { name: 'Kiểm tra Mức ngọt' });
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Không Đường' }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(confirm.mock.calls[0][0].modifierSelections[0].options).toEqual([
      expect.objectContaining({ optionId: 'none', scaleFactor: 0 }),
    ]);
    expect(JSON.stringify(saved)).toBe(before);
  });
  it.each(['missing', 'ambiguous', 'inactive'])('never invents a default when configuration is %s', mode => {
    const configured = options.map(o => ({ ...o, isDefault: mode === 'ambiguous' ? true : o.isDefault && mode !== 'missing',
      isActive: mode === 'inactive' && o.id === 'normal' ? false : o.isActive }));
    const confirm = mount({ configured });
    expect(screen.getByRole('button', { name: 'Kiểm tra Mức ngọt' })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '80% (ít đường)' }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(confirm.mock.calls[0][0].modifierSelections[0].options[0].optionId).toBe('less');
  });
  it('corrects multiple saved choices to the exact option tapped by the cashier', () => {
    const confirm = mount({ initial: snapshot(['normal', 'less']) });
    fireEvent.click(screen.getByRole('button', { name: '80% (ít đường)' }));
    expect(screen.getByRole('button', { name: '100% (bình thường)' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(confirm.mock.calls[0][0].modifierSelections[0].options).toEqual([
      expect.objectContaining({ optionId: 'less', scaleFactor: 0.8 }),
    ]);
  });
  it('keeps unrelated optional single-choice groups clearable', () => {
    const confirm = mount({ name: 'Topping tùy chọn' });
    fireEvent.click(screen.getByRole('button', { name: '100% (bình thường)' }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(confirm.mock.calls[0][0].modifierSelections[0].options).toEqual([]);
  });
});
