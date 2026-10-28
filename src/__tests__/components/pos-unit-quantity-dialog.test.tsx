import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PosUnitQuantityDialog } from '@/app/pos/components/unit-quantity-dialog';
import type { UOMConversion } from '@/lib/types';
it('applies canonical quantity after package entry without a price or checkout side effect',()=>{
 const apply=vi.fn(),close=vi.fn();
 render(<PosUnitQuantityDialog name="Sữa" unit="Lon" quantity={1} unitPrice={10000} conversions={[{fromUnit:'Thùng',toUnit:'Lon',factor:12,isActive:true}] as UOMConversion[]} onClose={close} onApply={apply}/>);
 fireEvent.change(screen.getByLabelText('Đơn vị Số lượng Sữa'),{target:{value:'Thùng'}});
 fireEvent.change(screen.getByLabelText('Số lượng Sữa'),{target:{value:'2'}});
 expect(screen.getByText('Thành tiền: 240,000')).toBeVisible();
 expect(apply).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Áp dụng'}));
 expect(apply).toHaveBeenCalledExactlyOnceWith(24);expect(close).toHaveBeenCalledOnce();
});
