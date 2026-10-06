\set ON_ERROR_STOP on
CREATE TABLE public.code_sequences (
  tenant_id uuid NOT NULL, entity_type text NOT NULL, prefix text NOT NULL,
  current_number integer NOT NULL, padding integer NOT NULL,
  UNIQUE (tenant_id, entity_type)
);
CREATE TABLE public.invoices (tenant_id uuid NOT NULL, code text NOT NULL, status text, UNIQUE (tenant_id, code));
CREATE FUNCTION public.next_cash_code(uuid,text) RETURNS text LANGUAGE sql AS $$ SELECT 'CASH_UNCHANGED'::text $$;
CREATE FUNCTION public.next_code(p_tenant_id uuid, p_entity_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_prefix text; v_number integer; v_padding integer;
BEGIN
  IF p_entity_type IN ('cash_receipt', 'cash_payment') THEN
    RETURN public.next_cash_code(p_tenant_id, p_entity_type);
  END IF;
  UPDATE public.code_sequences SET current_number=current_number+1
  WHERE tenant_id=p_tenant_id AND entity_type=p_entity_type
  RETURNING prefix,current_number,padding INTO v_prefix,v_number,v_padding;
  RETURN v_prefix || lpad(v_number::text,v_padding,'0');
END;
$$;
\ir ../migrations/00433_invoice_code_collision_guard.sql
\ir ../migrations/00433_invoice_code_collision_guard.sql

DO $$
DECLARE
  t uuid := '10000000-0000-0000-0000-000000000001';
  other_t uuid := '10000000-0000-0000-0000-000000000002';
  n integer;
BEGIN
  IF public.next_code(t,'invoice') <> 'HD000001' THEN RAISE EXCEPTION 'first code'; END IF;
  INSERT INTO public.invoices VALUES (t,'HD000002','cancelled'),(t,'HD096524','cancelled');
  IF public.next_code(t,'invoice') <> 'HD000003' THEN RAISE EXCEPTION 'skip occupied, not outlier'; END IF;
  IF public.next_code(other_t,'invoice') <> 'HD000001' THEN RAISE EXCEPTION 'tenant isolation'; END IF;
  IF public.next_code(t,'cash_receipt') <> 'CASH_UNCHANGED' THEN RAISE EXCEPTION 'cash changed'; END IF;
  INSERT INTO public.code_sequences VALUES (t,'order','DH',10,6);
  IF public.next_code(t,'order') <> 'DH000011' THEN RAISE EXCEPTION 'other series changed'; END IF;
  UPDATE public.code_sequences SET current_number=999999 WHERE tenant_id=t AND entity_type='invoice';
  IF public.next_code(t,'invoice') <> 'HD1000000' THEN RAISE EXCEPTION 'number truncated'; END IF;
  BEGIN
    PERFORM public.next_code(t,'invoice');
    RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='simulate failed checkout';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  SELECT current_number INTO n FROM public.code_sequences WHERE tenant_id=t AND entity_type='invoice';
  IF n<>1000000 THEN RAISE EXCEPTION 'failed transaction consumed code'; END IF;
  UPDATE public.code_sequences SET current_number=0 WHERE tenant_id=t AND entity_type='invoice';
  INSERT INTO public.invoices SELECT t,'HD'||lpad(i::text,6,'0'),'completed'
  FROM generate_series(1,1000) i ON CONFLICT DO NOTHING;
  BEGIN
    PERFORM public.next_code(t,'invoice');
    RAISE EXCEPTION 'collision limit did not stop';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM <> 'INVOICE_CODE_COLLISION_LIMIT' THEN RAISE; END IF;
  END;
  SELECT current_number INTO n FROM public.code_sequences WHERE tenant_id=t AND entity_type='invoice';
  IF n<>0 THEN RAISE EXCEPTION 'collision failure changed counter'; END IF;
  UPDATE public.code_sequences SET prefix='CUSTOM' WHERE tenant_id=t AND entity_type='invoice';
  BEGIN
    PERFORM public.next_code(t,'invoice');
    RAISE EXCEPTION 'invalid series accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM <> 'INVOICE_CODE_SERIES_INVALID' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.invoices WHERE code='HD096524' AND status='cancelled')<>1 THEN
    RAISE EXCEPTION 'history changed';
  END IF;
END;
$$;

SELECT 'invoice allocation checks passed' AS result;
