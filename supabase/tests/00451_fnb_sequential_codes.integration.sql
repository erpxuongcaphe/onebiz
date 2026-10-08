-- Run in an isolated database only. The runner loads original split/next_code
-- definitions and migration 00451 after this fixture.
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END;$$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '10000000-0000-4000-8000-000000000001'::uuid$$;
CREATE TABLE profiles(id uuid, tenant_id uuid, is_active boolean);
CREATE FUNCTION user_has_permission(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION user_has_branch_access(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE TABLE code_sequences(tenant_id uuid, entity_type text, prefix text, current_number integer, padding integer, UNIQUE(tenant_id,entity_type));
CREATE TABLE kitchen_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, branch_id uuid, table_id uuid, order_number text, order_type text, status text, invoice_id uuid, note text, created_by uuid, parent_order_id uuid, discount_amount numeric, discount_reason text, updated_at timestamptz);
CREATE TABLE kitchen_order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kitchen_order_id uuid, quantity numeric, unit_price numeric);
CREATE TABLE audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
CREATE FUNCTION next_cash_code(uuid,text) RETURNS text LANGUAGE sql AS $$SELECT 'CASH-UNCHANGED'$$;

-- psql integration entry point; isolated fixture ends above this marker.
CREATE FUNCTION next_code(p_tenant_id uuid,p_entity_type text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_prefix text; v_number integer; v_padding integer;
BEGIN
  IF p_entity_type = 'cash_receipt' THEN RETURN next_cash_code(p_tenant_id,'receipt'); END IF;
  UPDATE public.code_sequences SET current_number=current_number+1
  WHERE tenant_id=p_tenant_id AND entity_type=p_entity_type
  RETURNING prefix,current_number,padding INTO v_prefix,v_number,v_padding;
  IF NOT FOUND THEN
    INSERT INTO code_sequences VALUES(p_tenant_id,p_entity_type,upper(left(p_entity_type,2)),1,6)
    RETURNING prefix,current_number,padding INTO v_prefix,v_number,v_padding;
  END IF;
  RETURN v_prefix || lpad(v_number::text,v_padding,'0');
END;$$;
\ir ../migrations/00273_atomic_fnb_split_bill.sql
\ir ../migrations/00451_fnb_sequential_split_bill_codes.sql
DO $$
DECLARE t uuid := '10000000-0000-4000-8000-000000000002'; p uuid := gen_random_uuid(); i uuid := gen_random_uuid(); result jsonb;
BEGIN
 INSERT INTO profiles VALUES(auth.uid(),t,true);
 INSERT INTO kitchen_orders(id,tenant_id,branch_id,order_number,order_type,status,discount_amount)
 VALUES(p,t,gen_random_uuid(),'KB000001','dine_in','ready',3000);
 INSERT INTO kitchen_order_items(id,kitchen_order_id,quantity,unit_price) VALUES(i,p,1,10000),(gen_random_uuid(),p,1,20000);
 result := split_kitchen_order_atomic(p,'items',ARRAY[i],null);
 IF result->'children'->0->>'order_number' <> 'KB000002' THEN RAISE EXCEPTION 'split code not sequential'; END IF;
 IF (SELECT parent_order_id FROM kitchen_orders WHERE id=(result->'children'->0->>'order_id')::uuid) <> p THEN RAISE EXCEPTION 'parent relation lost'; END IF;
 IF (SELECT sum(discount_amount) FROM kitchen_orders) <> 3000 THEN RAISE EXCEPTION 'discount changed'; END IF;
 IF (SELECT sum(quantity*unit_price) FROM kitchen_order_items) <> 30000 THEN RAISE EXCEPTION 'item value changed'; END IF;
 IF next_code(t,'kitchen_order') <> 'KB000003' THEN RAISE EXCEPTION 'normal order series differs'; END IF;
 IF next_code(t,'cash_receipt') <> 'CASH-UNCHANGED' THEN RAISE EXCEPTION 'cash allocator changed'; END IF;
 UPDATE code_sequences SET current_number=999999 WHERE tenant_id=t AND entity_type='kitchen_order';
 IF next_code(t,'kitchen_order') <> 'KB1000000' THEN RAISE EXCEPTION 'sequence truncated'; END IF;
END;$$;
