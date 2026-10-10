import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FnbItemDialog } from '@/app/pos/fnb/components/fnb-item-dialog';

afterEach(cleanup);
const product = { id: 'cup', name: 'Ly Mang Về', sell_price: 0, allow_free_sale: true };
const variants = [{ id: 'm', label: 'Size M', sell_price: 0, is_default: true }, { id: 'l', label: 'Size L', sell_price: 0 }];
describe('F&B configured preparation options', () => {
  it('empty configuration shows cup variants without invented sugar or ice options', () => {
    const onConfirm = vi.fn();
    render(<FnbItemDialog open onOpenChange={vi.fn()} product={product} variants={variants}
      dynamicModifiers={{ groups: [], optionsByGroup: new Map() }} onConfirm={onConfirm} />);
    expect(screen.queryByText('Mức đường')).not.toBeInTheDocument();
    expect(screen.queryByText('Mức đá')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Size L/ }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ productId: 'cup', variantId: 'l', unitPrice: 0, quantity: 1 }));
  });
  it('loading configuration cannot confirm or display invented options', () => {
    render(<FnbItemDialog open onOpenChange={vi.fn()} product={product} variants={variants} onConfirm={vi.fn()} />);
    expect(screen.queryByText('Mức đường')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Đang tải/ })).toBeDisabled();
  });
  it('a configured required group still requires and records its selection', () => {
    const onConfirm = vi.fn();
    const group = { id: 'sugar', tenantId: 'tenant', name: 'Mức đường', rule: 'single_required' as const,
      channel: 'fnb' as const, sortOrder: 0, minSelect: 0, maxSelect: null, isActive: true, createdAt: '', updatedAt: '' };
    const option = { id: 'half', groupId: 'sugar', label: '50%', priceDelta: 0, scaleFactor: 0.5,
      linkedProductId: null, isDefault: false, sortOrder: 0, isActive: true };
    render(<FnbItemDialog open onOpenChange={vi.fn()} product={product} variants={variants}
      dynamicModifiers={{ groups: [group], optionsByGroup: new Map([['sugar', [option]]]) }} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Kiểm tra Mức đường' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    fireEvent.click(screen.getByRole('button', { name: /Thêm vào đơn/ }));
    expect(onConfirm.mock.calls[0][0].modifierSelections).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: 'sugar' }),
    ]));
  });
});
