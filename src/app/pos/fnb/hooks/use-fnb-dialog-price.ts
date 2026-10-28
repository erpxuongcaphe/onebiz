"use client";
import { useMemo } from "react";

/** Both add and edit dialogs must receive the active branch/platform price. */
export function useFnbDialogPrice<T extends {id:string;sell_price:number}>(
  product:T|null,
  resolve:(input:{productId:string;catalogPrice:number})=>number,
):T|null {
  return useMemo(()=>product ? {
    ...product,
    sell_price:resolve({productId:product.id,catalogPrice:product.sell_price}),
  } : null,[product,resolve]);
}
