import {cleanup,fireEvent,render,renderHook,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FnbItemDialog} from '@/app/pos/fnb/components/fnb-item-dialog';
import {useFnbDialogPrice} from '@/app/pos/fnb/hooks/use-fnb-dialog-price';
afterEach(cleanup);
const raw={id:'coffee',name:'Cà Phê Tươi (Máy)',sell_price:22000};
describe('add/edit F&B dialog branch price',()=>{
 it('editing a raw catalog product keeps branch price, quantity and note through confirmation',()=>{
  const onConfirm=vi.fn();const resolve=vi.fn(()=>25000);
  function Editor(){const product=useFnbDialogPrice(raw,resolve);return <FnbItemDialog open onOpenChange={()=>{}} product={product} initialSelection={{quantity:2,note:'Ít đá'}} dynamicModifiers={{groups:[],optionsByGroup:new Map()}} onConfirm={onConfirm}/>;}
  render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:/Thêm vào đơn/}));
  expect(resolve).toHaveBeenCalledWith({productId:'coffee',catalogPrice:22000});
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({unitPrice:25000,quantity:2,note:'Ít đá'}));
  expect(raw.sell_price).toBe(22000);
 });
 it('retains identity during unrelated renders and follows branch/platform resolver changes',()=>{
  const premium=()=>25000,platform=()=>35000,catalog=({catalogPrice}:{catalogPrice:number})=>catalogPrice;
  const {result,rerender}=renderHook(({resolve})=>useFnbDialogPrice(raw,resolve),{initialProps:{resolve:premium as (p:{productId:string;catalogPrice:number})=>number}});
  const first=result.current;rerender({resolve:premium});expect(result.current).toBe(first);
  rerender({resolve:platform});expect(result.current?.sell_price).toBe(35000);
  rerender({resolve:catalog});expect(result.current?.sell_price).toBe(22000);
 });
 it('preserves configured zero price and does not resolve a closed dialog product',()=>{
  const resolve=vi.fn(()=>0);const {result,rerender}=renderHook(({product})=>useFnbDialogPrice(product,resolve),{initialProps:{product:null as typeof raw|null}});
  expect(result.current).toBeNull();expect(resolve).not.toHaveBeenCalled();rerender({product:raw});expect(result.current?.sell_price).toBe(0);
 });
});
