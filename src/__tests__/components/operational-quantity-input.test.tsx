import React, {useState} from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import {OperationalQuantityInput} from "@/components/shared/operational-quantity-input";
import type {UOMConversion} from "@/lib/types";
const conversions=[{fromUnit:"Mẻ",toUnit:"G",factor:1100,isActive:true}] as UOMConversion[];
afterEach(cleanup);
function Fixture() {
 const [quantity,setQuantity]=useState(.5);
 return <><OperationalQuantityInput quantity={quantity} unit="Mẻ" conversions={conversions} label="Thạch" onChange={value=>setQuantity(value)} /><output>{String(quantity)}</output></>;
}
it("changing the entry unit retains the same stock quantity and uses declared grams",()=>{
 render(<Fixture/>);
 fireEvent.change(screen.getByRole('combobox',{name:'Đơn vị Thạch'}),{target:{value:'G'}});
 expect(screen.getByRole('spinbutton',{name:'Thạch'})).toHaveValue(550);
 expect(screen.getByRole('status')).toHaveTextContent('0.5');
 fireEvent.change(screen.getByRole('spinbutton',{name:'Thạch'}),{target:{value:'825'}});
 expect(screen.getByRole('status')).toHaveTextContent('0.75');
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'Mẻ'}});
 expect(screen.getByRole('spinbutton')).toHaveValue(.75);
});
it("retains the original weight in the entry while showing the ledger quantity",()=>{
 render(<Fixture/>);
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'G'}});
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'1'}});
 expect(screen.getByRole('spinbutton')).toHaveValue(1);
 expect(screen.getByRole('status')).toHaveTextContent('0.0009');
 expect(screen.getByText('Ghi kho 0,0009 Mẻ')).toBeTruthy();
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:''}});
 expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid','true');
 expect(screen.getByRole('status')).toHaveTextContent('NaN');
});
