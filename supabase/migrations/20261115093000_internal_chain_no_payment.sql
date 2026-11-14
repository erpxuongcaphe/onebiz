begin;
set local lock_timeout = '3s';

-- Existing clients can still submit the old payload; the server decides how
-- to account for an internal movement. Historical invoices keep their values.
alter table public.invoices drop constraint invoices_payment_method_check;
alter table public.invoices add constraint invoices_payment_method_check
  check (payment_method in ('cash','transfer','card','mixed')
         or (payment_method = 'internal' and source is not distinct from 'internal')) not valid;

do $migration$
declare
  patch record;
  body text;
  pos_body text;
  receipt_body text;
begin
  for patch in select * from (values
    ('public._create_internal_sale_auth_impl_00243(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)',
     'v_debt := v_total - v_paid;',
     'v_pay_method := ''internal''; v_paid := 0; v_debt := 0;'),
    ('public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)',
     'total=v_total,paid=v_paid,debt=v_total-v_paid,',
     'total=v_total,paid=0,debt=0,'),
    ('public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)',
     'payment_method=v_method,amount_tendered=coalesce((p_checkout->>''amountTendered'')::numeric,v_paid),',
     'payment_method=''internal'',amount_tendered=0,'),
    ('public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)',
     '''total'',v_total,''paid'',v_paid,''debt'',v_total-v_paid,',
     '''total'',v_total,''paid'',0,''debt'',0,'),
    ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)',
     'reduced:=least(invoice_debt,total);',
     'reduced:=0;'),
    ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)',
     'update invoices v set debt=v.debt-reduced where id=s.invoice_id and tenant_id=t;',
     ''),
    ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)',
     'total,reduced,total-reduced',
     'total,reduced,0'),
    ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)',
     '''refund_pending'',total-reduced',
     '''refund_pending'',0'),
    ('public.receive_internal_stock_return(uuid,jsonb,text,uuid)',
     '''refundPending'',total-reduced',
     '''refundPending'',0')
  ) as x(signature, old_code, new_code)
  loop
    body := pg_get_functiondef(patch.signature::regprocedure);
    if (length(body)-length(replace(body,patch.old_code,''))) <> length(patch.old_code) then
      raise exception 'Internal accounting migration: unexpected definition of %',patch.signature;
    end if;
    execute replace(body,patch.old_code,patch.new_code);
  end loop;

  pos_body := pg_get_functiondef('public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)'::regprocedure);
  body := regexp_replace(pos_body,
    'for v_pay in select value from jsonb_array_elements[(]p_checkout->''payments''[)] loop[[:space:]]+v_amount:=[^;]+; v_method:=[^;]+;[[:space:]]+insert into cash_transactions[^;]+;[[:space:]]+insert into cash_transactions[^;]+;[[:space:]]+end loop;',
    '');
  if body = pos_body or position('insert into cash_transactions' in lower(body)) > 0 then
    raise exception 'Internal accounting migration: POS cash posting block changed';
  end if;
  execute body;

  receipt_body := pg_get_functiondef('public.receive_internal_stock_return(uuid,jsonb,text,uuid)'::regprocedure);
  body := regexp_replace(receipt_body,
    'if total>reduced then[[:space:]]+perform 1 from customers[^;]+;[[:space:]]+if not found then raise exception ''RETURN_CUSTOMER_MISSING''; end if;[[:space:]]+insert into customer_debt_adjustments[^;]+;[[:space:]]+end if;',
    '');
  if body = receipt_body or position('insert into customer_debt_adjustments' in lower(body)) > 0 then
    raise exception 'Internal accounting migration: return credit posting block changed';
  end if;
  execute body;
end;
$migration$;

commit;
