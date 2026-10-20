-- Read-only receiving management metadata; keep existing branch authorization.
begin;
set local lock_timeout='3s';
do $patch$
declare d text; a text; b text;
begin
 d:=replace(pg_get_functiondef('public.get_internal_receiving_workspace(uuid)'::regprocedure),E'\r\n',E'\n');
 a:='status=''completed'' and receipt_mode=''actual''';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'RECEIVING_LIST_SCOPE_PATCH_MISMATCH'; end if;
 d:=replace(d,a,'status in (''draft'',''confirmed'',''completed'',''cancelled'')');
 a:='''invoiceId'',s.invoice_id,';
 b:=a||'''status'',s.status,''receiptMode'',s.receipt_mode,''fromBranchId'',s.from_branch_id,''toBranchId'',s.to_branch_id,''toBranch'',(select name from public.branches where id=s.to_branch_id and tenant_id=s.tenant_id),''createdBy'',(select full_name from public.profiles where id=s.created_by and tenant_id=s.tenant_id),''note'',s.note,';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'RECEIVING_LIST_METADATA_PATCH_MISMATCH'; end if;
 d:=replace(d,a,b);
 a:='''received'',coalesce(q.quantity,0)';
 b:='''received'',case when s.receipt_mode=''legacy'' and s.status=''completed'' then i.quantity else coalesce(q.quantity,0) end';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'RECEIVING_LEGACY_READ_PATCH_MISMATCH'; end if;
 execute replace(d,a,b);

 d:=replace(pg_get_functiondef('public.get_management_finance_workspace(date,date,uuid,text,uuid,text,integer,integer,text,text,text)'::regprocedure),E'\r\n',E'\n');
 a:='''source_receipt_id'',x.receipt_id,';
 b:=a||'''source_sale_code'',s.code,''source_product_code'',(select product_code from public.internal_sale_items where id=x.sale_item_id and internal_sale_id=s.id),''source_product_name'',(select product_name from public.internal_sale_items where id=x.sale_item_id and internal_sale_id=s.id),''source_quantity'',x.quantity,''source_unit'',(select unit from public.internal_sale_items where id=x.sale_item_id and internal_sale_id=s.id),''source_unit_price'',(select unit_price from public.internal_sale_items where id=x.sale_item_id and internal_sale_id=s.id),';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'RECEIVING_EXPENSE_METADATA_PATCH_MISMATCH'; end if;
 execute replace(d,a,b);
end $patch$;
commit;
notify pgrst,'reload schema';
