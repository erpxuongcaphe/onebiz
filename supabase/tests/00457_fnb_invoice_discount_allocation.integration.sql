\set ON_ERROR_STOP on
\ir 00454_fnb_effective_unpaid_quantities.integration.sql
alter table products add category_id uuid;
alter table promotions add tenant_id uuid,add applies_to text,add applies_to_ids uuid[];
alter table coupons add tenant_id uuid,add code text,add applies_to text,add applies_to_ids uuid[];
\ir ../migrations/00457_fnb_invoice_discount_allocation.sql
\ir ../migrations/00457_fnb_invoice_discount_allocation.sql
-- Three one-VND lines exercise deterministic remainder; scope one line only.
insert into invoices(id,tenant_id,branch_id,source,subtotal,discount_amount,total,paid) values
('00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','fnb',3,2,1,1);
insert into invoice_items(id,invoice_id,product_id,product_name,unit,quantity,unit_price,discount,total,vat_amount,vat_rate) values
('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000010','UAT','Cái',1,1,0,1,0,0),
('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000010','UAT','Cái',1,1,0,1,0,0),
('00000000-0000-0000-0000-000000000083','00000000-0000-0000-0000-000000000080','00000000-0000-0000-0000-000000000010','UAT','Cái',1,1,0,1,0,0);
select _fnb_allocate_invoice_discounts_00457('00000000-0000-0000-0000-000000000080',null,null,0,0);
do $$ declare snapshot jsonb; begin
 if (select sum(total) from invoice_items where invoice_id='00000000-0000-0000-0000-000000000080')<>1
 or (select sum(discount) from invoice_items where invoice_id='00000000-0000-0000-0000-000000000080')<>2 then raise exception 'Line/bill total mismatch'; end if;
 if (select total from invoice_items where id='00000000-0000-0000-0000-000000000083')<>1 then raise exception 'Remainder order is not deterministic'; end if;
 select lines into snapshot from fnb_invoice_discount_snapshots where invoice_id='00000000-0000-0000-0000-000000000080';
 perform _fnb_allocate_invoice_discounts_00457('00000000-0000-0000-0000-000000000080',null,null,999,999);
 if snapshot<>(select lines from fnb_invoice_discount_snapshots where invoice_id='00000000-0000-0000-0000-000000000080') then raise exception 'Snapshot changed on retry'; end if;
end $$;
-- Two disjoint scopes must never leak discounts to an ineligible product.
insert into promotions(id,tenant_id,applies_to,applies_to_ids) values
('00000000-0000-0000-0000-000000000085','00000000-0000-0000-0000-000000000002','product',array['00000000-0000-0000-0000-000000000010'::uuid]);
insert into coupons(id,tenant_id,code,applies_to,applies_to_ids) values
('00000000-0000-0000-0000-000000000086','00000000-0000-0000-0000-000000000002','UAT-SCOPE','product',array['00000000-0000-0000-0000-000000000011'::uuid]);
insert into invoices(id,tenant_id,branch_id,source,subtotal,discount_amount,total,paid) values
('00000000-0000-0000-0000-000000000087','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','fnb',200,60,140,140);
insert into invoice_items(id,invoice_id,product_id,product_name,unit,quantity,unit_price,discount,total,vat_amount,vat_rate) values
('00000000-0000-0000-0000-000000000088','00000000-0000-0000-0000-000000000087','00000000-0000-0000-0000-000000000010','UAT drink','Cái',1,100,0,100,0,0),
('00000000-0000-0000-0000-000000000089','00000000-0000-0000-0000-000000000087','00000000-0000-0000-0000-000000000011','UAT other','Cái',1,100,0,100,0,0);
select _fnb_allocate_invoice_discounts_00457('00000000-0000-0000-0000-000000000087','00000000-0000-0000-0000-000000000085','UAT-SCOPE',20,40);
do $$ begin
 if (select discount from invoice_items where id='00000000-0000-0000-0000-000000000088')<>20
 or (select discount from invoice_items where id='00000000-0000-0000-0000-000000000089')<>40 then raise exception 'Scoped discount leaked across products'; end if;
end $$;
-- Exercise the patched real checkout and source mapping, including toppings.
select fnb_complete_payment_atomic_v3((select kitchen_order_id from kitchen_order_items where id='00000000-0000-0000-0000-000000000031'),null,'UAT','cash',null,100000,false,0,null,null,null,'00000000-0000-0000-0000-000000000007');
do $$ declare invoice uuid; begin
 select invoice_id into invoice from kitchen_orders where id=(select kitchen_order_id from kitchen_order_items where id='00000000-0000-0000-0000-000000000031');
 if (select sum(total) from invoice_items where invoice_id=invoice)<>63000
 or (select sum(discount) from invoice_items where invoice_id=invoice)<>7000 then raise exception 'Topping/discount net refund basis mismatch'; end if;
 if not exists(select 1 from fnb_invoice_discount_snapshots where invoice_id=invoice) then raise exception 'Real checkout did not capture snapshot'; end if;
 if has_table_privilege('authenticated','fnb_invoice_discount_snapshots','UPDATE') then raise exception 'Snapshot is publicly editable'; end if;
end $$;
