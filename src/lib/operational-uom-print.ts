import type { DocumentPrintData } from "./print-document";
import { getClient, getCurrentTenantId } from "./services/supabase/base";
import { formatOperationalQuantity } from "./operational-uom";

/** Only stock documents query this metadata; POS/kitchen printing is unchanged. */
export async function withOperationalPrintUnits(base: DocumentPrintData, docType: string): Promise<DocumentPrintData> {
  const kind = ({production_order:"production",disposal:"disposal",internal_export:"internal_export",stock_transfer:"transfer",inventory_check:"inventory_check"} as Record<string,string>)[docType];
  if(!kind)return base;
  const tenant = await getCurrentTenantId();
  const {data,error} = await (getClient().from as any)('operational_uom_requests').select('snapshots').eq('tenant_id',tenant).eq('reference_type',kind).eq('result->>code',base.documentCode).limit(1);
  if(error) throw new Error("Chưa tải được đơn vị ghi nhận để in chứng từ.");
  const snapshots=data?.[0]?.snapshots as {productName?:string;inputQuantity:number;inputUnit:string;stockQuantity:number;stockUnit:string;parts?:{quantity:number;unit:string}[]}[] | undefined;
  if(!snapshots?.length)return base;
  const value=snapshots.map(row => `${row.productName || ''}: ${row.parts?.length ? row.parts.map(part=>`${formatOperationalQuantity(Number(part.quantity))} ${part.unit}`).join(' + ') : `${formatOperationalQuantity(Number(row.inputQuantity))} ${row.inputUnit}`} → ${formatOperationalQuantity(Number(row.stockQuantity))} ${row.stockUnit}`).join('; ');
  return {...base,headerFields:[...(base.headerFields ?? []),{label:"Đơn vị ghi nhận",value}]};
}
