-- New documents only. No automatic return, stock backfill or cash payment.
begin;
set local lock_timeout='3s';
-- Match the four-decimal stock unit precision; existing values are preserved.
alter table public.return_items alter column quantity type numeric(18,4);

create table public.internal_stock_returns (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 sale_id uuid not null references public.internal_sales(id), code text not null,
 from_branch_id uuid not null references public.branches(id), to_branch_id uuid not null references public.branches(id),
 status text not null default 'sent' check(status in ('sent','partial','received')),
 reason text not null check(length(trim(reason)) between 3 and 500),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(tenant_id,code), check(from_branch_id<>to_branch_id)
);
create table public.internal_stock_return_items (
 id uuid primary key default gen_random_uuid(), return_id uuid not null references public.internal_stock_returns(id),
 sale_item_id uuid not null references public.internal_sale_items(id),
 invoice_item_id uuid not null references public.invoice_items(id),
 product_id uuid not null references public.products(id), receiving_product_id uuid not null references public.products(id),
 product_code text not null, product_name text not null, unit text not null, receiving_unit text not null,
 factor numeric not null check(factor>0), quantity numeric(18,4) not null check(quantity>0),
 received numeric(18,4) not null default 0 check(received>=0 and received<=quantity),
 credit_per_unit numeric not null check(credit_per_unit>=0), warehouse_unit_cost numeric not null check(warehouse_unit_cost>=0),
 branch_unit_cost numeric not null check(branch_unit_cost>=0), lots jsonb not null default '[]',
 unique(return_id,sale_item_id)
);
create table public.internal_stock_return_events (
 id uuid primary key default gen_random_uuid(), return_id uuid not null references public.internal_stock_returns(id),
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 action text not null check(action in ('sent','received')), items jsonb not null, note text,
 credit_amount numeric not null default 0, debt_reduced numeric not null default 0, refund_pending numeric not null default 0
);
create table public.internal_stock_return_requests (
 tenant_id uuid not null references public.tenants(id), request_id uuid not null, payload jsonb not null,
 result jsonb not null, primary key(tenant_id,request_id)
);
create index internal_returns_from on public.internal_stock_returns(tenant_id,from_branch_id,created_at desc);
create index internal_returns_to on public.internal_stock_returns(tenant_id,to_branch_id,created_at desc);
create index internal_returns_sale on public.internal_stock_returns(sale_id);
create index internal_return_items_source on public.internal_stock_return_items(sale_item_id);
create index internal_return_events_parent on public.internal_stock_return_events(return_id,created_at);
alter table public.internal_stock_returns enable row level security;
alter table public.internal_stock_return_items enable row level security;
alter table public.internal_stock_return_events enable row level security;
alter table public.internal_stock_return_requests enable row level security;
revoke all on public.internal_stock_returns,public.internal_stock_return_items,public.internal_stock_return_events,public.internal_stock_return_requests from public,anon,authenticated;
-- Access is exposed only through bounded, scoped RPCs below.

create function public.get_internal_stock_returns(p_branch_id uuid,p_sale_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare t uuid:=public.get_user_tenant_id(); result jsonb;
begin
 if auth.uid() is null or t is null or not public.user_has_permission(auth.uid(),'inventory.view')
 or not public.user_has_branch_access(auth.uid(),p_branch_id)
 or not (public.user_has_permission(auth.uid(),'inventory.internal_return_send') or public.user_has_permission(auth.uid(),'inventory.internal_return_receive')) then raise exception 'RETURN_SCOPE_DENIED'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from (
 select r.*,s.code sale_code,b.name from_branch_name,w.name to_branch_name,p.full_name created_by_name,
 (select greatest(coalesce(v.debt,0),0) from invoices v where v.id=s.invoice_id) invoice_debt,
 (select coalesce(jsonb_agg((to_jsonb(i)-'warehouse_unit_cost'-'branch_unit_cost'-'lots') order by i.product_name),'[]') from internal_stock_return_items i where i.return_id=r.id) items,
 (select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.full_name) order by e.created_at),'[]')
  from internal_stock_return_events e left join profiles ep on ep.id=e.actor_id where e.return_id=r.id) events
 from internal_stock_returns r join internal_sales s on s.id=r.sale_id
 join branches b on b.id=r.from_branch_id join branches w on w.id=r.to_branch_id
 left join profiles p on p.id=r.created_by
 where r.tenant_id=t and p_branch_id in (r.from_branch_id,r.to_branch_id) and (p_sale_id is null or r.sale_id=p_sale_id)
 order by r.created_at desc,r.id limit 200) q;
 return result;
end $$;

create function public.send_internal_stock_return(p_sale_id uuid,p_items jsonb,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 t uuid:=public.get_user_tenant_id(); a uuid:=auth.uid(); s internal_sales%rowtype; i internal_sale_items%rowtype;
 x jsonb; qty numeric; received_qty numeric; returned_qty numeric; stock_qty numeric; factor numeric; product uuid;
 rid uuid:=gen_random_uuid(); move_id uuid; branch_cost numeric; warehouse_cost numeric; result jsonb; payload jsonb;
 previous internal_stock_return_requests%rowtype; lot_result jsonb; return_code text; receiving_unit text;
 lot record; lot_take numeric; lot_remaining numeric;
 source_line invoice_items%rowtype; source_invoice invoices%rowtype; line_count integer; line_sum numeric; credit numeric;
begin
 if a is null or t is null or not public.user_has_permission(a,'inventory.internal_return_send') then raise exception 'RETURN_SEND_DENIED'; end if;
 if p_request_id is null then raise exception 'RETURN_REQUEST_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||p_request_id::text,0));
 select * into s from internal_sales where id=p_sale_id and tenant_id=t for update;
 if not found or not public.user_has_branch_access(a,s.to_branch_id) then raise exception 'RETURN_SCOPE_DENIED'; end if;
 payload:=jsonb_build_object('action','send','sale',p_sale_id,'items',p_items,'reason',trim(p_reason));
 select * into previous from internal_stock_return_requests where tenant_id=t and request_id=p_request_id;
 if found then
  if previous.payload<>payload then raise exception 'RETURN_REQUEST_CHANGED'; end if;
  return previous.result;
 end if;
 if s.status<>'completed' then raise exception 'RETURN_SOURCE_NOT_RECEIVED'; end if;
 select * into source_invoice from invoices where id=s.invoice_id and tenant_id=t for update;
 if not found or source_invoice.status<>'completed' then raise exception 'RETURN_INVOICE_MISSING'; end if;
 select sum(total) into line_sum from invoice_items where invoice_id=s.invoice_id;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'RETURN_REASON_REQUIRED'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'RETURN_ITEMS_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) e group by e->>'itemId' having count(*)>1) then raise exception 'RETURN_DUPLICATE_ITEM'; end if;
 perform 1 from products where tenant_id=t and id in (
 select product_id from internal_sale_items where internal_sale_id=s.id union
 select receiving_product_id from internal_sale_items where internal_sale_id=s.id) order by id for update;
 return_code:='TN-'||upper(substr(replace(rid::text,'-',''),1,12));
 insert into internal_stock_returns(id,tenant_id,sale_id,code,from_branch_id,to_branch_id,reason,created_by)
 values(rid,t,s.id,return_code,s.to_branch_id,s.from_branch_id,trim(p_reason),a);
 for x in select * from jsonb_array_elements(p_items) loop
  select * into i from internal_sale_items where id=(x->>'itemId')::uuid and internal_sale_id=s.id;
  if not found then raise exception 'RETURN_ITEM_SCOPE_INVALID'; end if;
  qty:=(x->>'quantity')::numeric;
  if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty<>round(qty,4) then raise exception 'RETURN_QUANTITY_INVALID'; end if;
  if coalesce((select treatment from internal_receiving_usage_confirmations where sale_item_id=i.id and tenant_id=t),i.receiving_treatment,'stock')<>'stock' then
   raise exception 'RETURN_NON_STOCK_ITEM' using detail=i.product_name;
  end if;
  product:=coalesce(i.receiving_product_id,i.product_id); factor:=coalesce(i.receiving_factor,1);
  stock_qty:=qty*factor;
  if stock_qty<>round(stock_qty,4) then raise exception 'RETURN_CONVERSION_PRECISION' using detail=i.product_name; end if;
  if s.receipt_mode='legacy' then received_qty:=i.quantity; else
   select coalesce(sum(ri.quantity),0) into received_qty from internal_sale_receipt_items ri
   join internal_sale_receipts r on r.id=ri.receipt_id where r.internal_sale_id=s.id and ri.sale_item_id=i.id;
  end if;
  select coalesce(sum(ri.quantity),0) into returned_qty from internal_stock_return_items ri where ri.sale_item_id=i.id;
  if qty>received_qty-returned_qty then raise exception 'RETURN_EXCEEDS_RECEIVED' using detail=i.product_name; end if;
  select p.unit into receiving_unit from products p where p.id=product and p.tenant_id=t;
  -- The original dispatch cost, not today's price, restores the warehouse cost.
  select count(*) into line_count from invoice_items where invoice_id=s.invoice_id and product_id=i.product_id;
  if line_count<>1 then raise exception 'RETURN_SOURCE_LINE_AMBIGUOUS' using detail=i.product_name; end if;
  select * into source_line from invoice_items where invoice_id=s.invoice_id and product_id=i.product_id;
  if source_line.quantity<>i.quantity then raise exception 'RETURN_SOURCE_LINE_AMBIGUOUS' using detail=i.product_name; end if;
  warehouse_cost:=source_line.unit_cost;
  if warehouse_cost is null then raise exception 'RETURN_ORIGINAL_COST_MISSING' using detail=i.product_name; end if;
  credit:=case when line_sum>0 then source_line.total*(source_invoice.subtotal-source_invoice.discount_amount)/line_sum else 0 end;
  credit:=(credit+coalesce(source_line.vat_amount,0))/source_line.quantity;
  if credit<0 then raise exception 'RETURN_SOURCE_PRICE_INVALID'; end if;
  update branch_stock set quantity=quantity-stock_qty,updated_at=now()
   where tenant_id=t and branch_id=s.to_branch_id and product_id=product and variant_id is null and quantity>=stock_qty;
  if not found then raise exception 'RETURN_STOCK_INSUFFICIENT' using detail=i.product_name; end if;
  perform increment_product_stock(product,-stock_qty);
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
   values(t,s.to_branch_id,product,'out',stock_qty,'internal_return',rid,return_code||' · '||trim(p_reason),a) returning id into move_id;
  if _fnb_branch_cost_tracking_enabled_00390(t,s.to_branch_id) then
   branch_cost:=_post_fnb_branch_cost_out_00390(t,s.to_branch_id,product,stock_qty,'stock_transfer','internal_return',rid,move_id,p_reason,a);
  else branch_cost:=i.unit_price/factor; end if;
  -- Returns can include expired stock. Do not use sale-only allocation, which
  -- skips expired lots and would recreate the returned stock without its expiry.
  lot_result:='[]'::jsonb; lot_remaining:=stock_qty;
  for lot in select l.* from product_lots l
   where l.tenant_id=t and l.branch_id=s.to_branch_id and l.product_id=product and l.current_qty>0 and l.status in ('active','expired')
   order by _lot_expiry_moment_00527(l.expiry_date,l.expiry_at) nulls last,l.received_date,l.created_at,l.id for update loop
   exit when lot_remaining<=0;
   lot_take:=least(lot_remaining,lot.current_qty);
   update product_lots set current_qty=current_qty-lot_take,
    status=case when current_qty-lot_take<=0 then 'consumed' else status end,updated_at=now() where id=lot.id;
   insert into lot_allocations(tenant_id,lot_id,source_type,source_id,quantity,allocated_by)
    values(t,lot.id,'transfer',rid,lot_take,a);
   lot_result:=lot_result||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'quantity',lot_take,
    'manufactured_date',lot.manufactured_date,'expiry_date',lot.expiry_date,'expiry_at',lot.expiry_at));
   lot_remaining:=lot_remaining-lot_take;
  end loop;
  insert into internal_stock_return_items(return_id,sale_item_id,invoice_item_id,product_id,receiving_product_id,product_code,product_name,unit,receiving_unit,
   factor,quantity,credit_per_unit,warehouse_unit_cost,branch_unit_cost,lots)
  values(rid,i.id,source_line.id,i.product_id,product,i.product_code,i.product_name,i.unit,receiving_unit,factor,qty,
   credit,warehouse_cost,branch_cost,lot_result);
 end loop;
 insert into internal_stock_return_events(return_id,actor_id,action,items,note) values(rid,a,'sent',p_items,trim(p_reason));
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(t,a,'internal_return_sent','internal_stock_return',rid,jsonb_build_object('source',s.id,'items',p_items,'reason',trim(p_reason)));
 result:=jsonb_build_object('id',rid,'code',return_code,'status','sent');
 insert into internal_stock_return_requests values(t,p_request_id,payload,result);
 return result;
end $$;

create function public.receive_internal_stock_return(p_return_id uuid,p_items jsonb,p_note text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 t uuid:=get_user_tenant_id(); a uuid:=auth.uid(); r internal_stock_returns%rowtype; s internal_sales%rowtype;
 i internal_stock_return_items%rowtype; x jsonb; qty numeric; move_id uuid; total numeric:=0; invoice_debt numeric; reduced numeric;
 previous internal_stock_return_requests%rowtype; payload jsonb; result jsonb; event_id uuid:=gen_random_uuid();
 lot jsonb; lot_offset numeric; taken numeric; skip_qty numeric; left_qty numeric;
 prior_qty numeric; line_credit numeric; financial_items jsonb:='[]'; source_invoice invoices%rowtype;
begin
 if a is null or t is null or not user_has_permission(a,'inventory.internal_return_receive') then raise exception 'RETURN_RECEIVE_DENIED'; end if;
 if p_request_id is null then raise exception 'RETURN_REQUEST_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||p_request_id::text,0));
 select * into r from internal_stock_returns where id=p_return_id and tenant_id=t;
 if not found or not user_has_branch_access(a,r.to_branch_id) then raise exception 'RETURN_SCOPE_DENIED'; end if;
 -- Same lock order as sending and editing the original receipt.
 select * into s from internal_sales where id=r.sale_id and tenant_id=t for update;
 select * into r from internal_stock_returns where id=p_return_id for update;
 payload:=jsonb_build_object('action','receive','return',p_return_id,'items',p_items,'note',coalesce(trim(p_note),''));
 select * into previous from internal_stock_return_requests where tenant_id=t and request_id=p_request_id;
 if found then
  if previous.payload<>payload then raise exception 'RETURN_REQUEST_CHANGED'; end if;
  return previous.result;
 end if;
 if r.status='received' then raise exception 'RETURN_ALREADY_RECEIVED'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'RETURN_ITEMS_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) e group by e->>'itemId' having count(*)>1) then raise exception 'RETURN_DUPLICATE_ITEM'; end if;
 perform 1 from products where tenant_id=t and id in(select product_id from internal_stock_return_items where return_id=r.id) order by id for update;
 select * into source_invoice from invoices v where v.id=s.invoice_id and v.tenant_id=t for update;
 if not found then raise exception 'RETURN_INVOICE_MISSING'; end if;
 invoice_debt:=greatest(coalesce(source_invoice.debt,0),0);
 for x in select * from jsonb_array_elements(p_items) loop
  select * into i from internal_stock_return_items where id=(x->>'itemId')::uuid and return_id=r.id for update;
  if not found then raise exception 'RETURN_ITEM_SCOPE_INVALID'; end if;
  qty:=(x->>'quantity')::numeric;
  if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty<>round(qty,4) or qty>i.quantity-i.received then raise exception 'RETURN_RECEIVE_QUANTITY_INVALID' using detail=i.product_name; end if;
  -- Cumulative rounding makes multiple receipts equal one receipt.
  select coalesce(sum(received),0) into prior_qty from internal_stock_return_items where sale_item_id=i.sale_item_id;
  line_credit:=round((prior_qty+qty)*i.credit_per_unit,2)-round(prior_qty*i.credit_per_unit,2);
  total:=total+line_credit;
  financial_items:=financial_items||jsonb_build_array(jsonb_build_object('id',i.id,'quantity',qty,'total',line_credit));
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
   values(t,r.to_branch_id,i.product_id,'in',qty,'internal_return_receipt',event_id,r.code||' · '||coalesce(p_note,''),a) returning id into move_id;
  perform increment_product_stock(i.product_id,qty);
  perform upsert_branch_stock(t,r.to_branch_id,i.product_id,qty);
  if _fnb_branch_cost_tracking_enabled_00390(t,r.to_branch_id) then
   perform _post_fnb_branch_cost_in_00390(t,r.to_branch_id,i.product_id,qty,i.warehouse_unit_cost,'stock_transfer','internal_return_receipt',event_id,move_id,p_note,a);
  end if;
  -- Carry original expiry metadata to returned lots, including partial receipts.
  skip_qty:=i.received*i.factor; left_qty:=qty*i.factor;
  for lot in select * from jsonb_array_elements(i.lots) loop
   lot_offset:=least(skip_qty,(lot->>'quantity')::numeric); skip_qty:=skip_qty-lot_offset;
   taken:=least(left_qty,(lot->>'quantity')::numeric-lot_offset);
   if taken>0 then
    insert into product_lots(tenant_id,branch_id,product_id,lot_number,source_type,initial_qty,current_qty,manufactured_date,expiry_date,expiry_at,note)
    values(t,r.to_branch_id,i.product_id,r.code||'-'||left(event_id::text,8)||'-'||left(lot->>'lot_id',8),'transfer',taken/i.factor,taken/i.factor,
    (lot->>'manufactured_date')::date,(lot->>'expiry_date')::date,(lot->>'expiry_at')::timestamptz,'Nhận trả nội bộ '||r.code);
    left_qty:=left_qty-taken;
   end if;
  end loop;
  if left_qty>0 then
   insert into product_lots(tenant_id,branch_id,product_id,lot_number,source_type,initial_qty,current_qty,note)
    values(t,r.to_branch_id,i.product_id,r.code||'-'||left(event_id::text,8),'transfer',left_qty/i.factor,left_qty/i.factor,'Nhận trả '||r.code||' · Nguồn không có thông tin hạn dùng');
  end if;
  update internal_stock_return_items set received=received+qty where id=i.id;
 end loop;
 reduced:=least(invoice_debt,total);
 update invoices v set debt=v.debt-reduced where id=s.invoice_id and tenant_id=t;
 insert into internal_stock_return_events(id,return_id,actor_id,action,items,note,credit_amount,debt_reduced,refund_pending)
 values(event_id,r.id,a,'received',p_items,p_note,total,reduced,total-reduced);
 -- Record a normal financial return only after the paired receipt has succeeded.
 -- No cash transaction is created. Existing finance reports see the credit.
 insert into sales_returns(id,tenant_id,branch_id,code,invoice_id,customer_id,customer_name,status,total,refunded,reason,note,created_by)
 values(event_id,t,r.to_branch_id,next_code(t,'sales_return'),s.invoice_id,source_invoice.customer_id,source_invoice.customer_name,
 'completed',total,0,r.reason,'Nhận trả nội bộ '||r.code,a);
 for x in select * from jsonb_array_elements(financial_items) loop
  select * into i from internal_stock_return_items where id=(x->>'id')::uuid;
  insert into return_items(return_id,invoice_item_id,product_id,product_name,unit,quantity,unit_price,total)
  values(event_id,i.invoice_item_id,i.product_id,i.product_name,i.unit,(x->>'quantity')::numeric,i.credit_per_unit,(x->>'total')::numeric);
  update invoice_items set returned_qty=coalesce(returned_qty,0)+(x->>'quantity')::numeric where id=i.invoice_item_id;
 end loop;
 if total>reduced then
  perform 1 from customers where id=source_invoice.customer_id and tenant_id=t for update;
  if not found then raise exception 'RETURN_CUSTOMER_MISSING'; end if;
  insert into customer_debt_adjustments(tenant_id,branch_id,customer_id,invoice_id,amount,reason,idempotency_key,created_by)
  values(t,r.to_branch_id,source_invoice.customer_id,s.invoice_id,-(total-reduced),'Chờ hoàn/cấn trừ '||r.code,'internal-return:'||event_id::text,a);
 end if;
 update internal_stock_returns set status=case when exists(select 1 from internal_stock_return_items where return_id=r.id and received<quantity) then 'partial' else 'received' end where id=r.id;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(t,a,'internal_return_received','internal_stock_return',r.id,jsonb_build_object('items',p_items,'credit',total,'debt_reduced',reduced,'refund_pending',total-reduced,'event',event_id));
 result:=jsonb_build_object('id',r.id,'credit',total,'debtReduced',reduced,'refundPending',total-reduced);
 insert into internal_stock_return_requests values(t,p_request_id,payload,result);
 return result;
end $$;

-- Only this paired workflow may create a return for an internal invoice.
do $patch$
declare definition text; needle text:='if exists(select 1 from invoices where id=new.invoice_id and source=''internal'') then';
begin
 definition:=pg_get_functiondef('public.guard_internal_document_reversal_00471()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'INTERNAL_RETURN_GUARD_VERSION_CHANGED'; end if;
 definition:=replace(definition,needle,'if exists(select 1 from invoices where id=new.invoice_id and source=''internal'') and not exists (
 select 1 from internal_stock_return_events e join internal_stock_returns r on r.id=e.return_id
 join internal_sales s on s.id=r.sale_id where e.id=new.id and e.action=''received''
 and r.tenant_id=new.tenant_id and r.to_branch_id=new.branch_id and s.invoice_id=new.invoice_id
 and e.actor_id=auth.uid() and new.created_by=auth.uid() and new.status=''completed''
 and new.total=e.credit_amount and new.refunded=0) then');
 execute definition;
end $patch$;

-- These finance rows are evidence of a confirmed warehouse receipt. Ordinary
-- sales-return editing must not undo only one side of a paired stock movement.
create function public.guard_internal_return_financial_record() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from internal_stock_return_events e where e.id=old.id and e.action='received') then
  raise exception 'Phiếu này được tạo từ xác nhận nhận trả nội bộ. Không sửa hoặc xóa riêng chứng từ tài chính; cần đối soát phiếu trả liên quan.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_internal_return_financial_record before update or delete on public.sales_returns
for each row execute function public.guard_internal_return_financial_record();
revoke all on function public.guard_internal_return_financial_record() from public,anon,authenticated;

create function public.guard_internal_received_return_quantity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare item uuid; sale uuid; current_qty numeric; sent_qty numeric; delta numeric;
begin
 item:=case when tg_op='DELETE' then old.sale_item_id else new.sale_item_id end;
 select internal_sale_id into sale from internal_sale_items where id=item;
 perform 1 from internal_sales where id=sale for update;
 select coalesce(sum(quantity),0) into current_qty from internal_sale_receipt_items where sale_item_id=item;
 select coalesce(sum(quantity),0) into sent_qty from internal_stock_return_items where sale_item_id=item;
 delta:=case when tg_op='DELETE' then -old.quantity when tg_op='UPDATE' then new.quantity-old.quantity else new.quantity end;
 if tg_op='UPDATE' and new.sale_item_id<>old.sale_item_id then raise exception 'RETURN_SOURCE_LINE_LOCKED'; end if;
 if sent_qty>0 and current_qty+delta<sent_qty then raise exception 'RETURN_RECEIPT_BELOW_SENT'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_internal_received_return_quantity before insert or update or delete on public.internal_sale_receipt_items
for each row execute function public.guard_internal_received_return_quantity();
revoke all on function public.guard_internal_received_return_quantity() from public,anon,authenticated;

revoke all on function public.get_internal_stock_returns(uuid,uuid),public.send_internal_stock_return(uuid,jsonb,text,uuid),public.receive_internal_stock_return(uuid,jsonb,text,uuid) from public,anon;
grant execute on function public.get_internal_stock_returns(uuid,uuid),public.send_internal_stock_return(uuid,jsonb,text,uuid),public.receive_internal_stock_return(uuid,jsonb,text,uuid) to authenticated;
commit;
notify pgrst,'reload schema';
