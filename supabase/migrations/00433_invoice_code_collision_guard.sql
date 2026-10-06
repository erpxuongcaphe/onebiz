BEGIN;

-- Keep the existing HD series; imported outliers must not reset its counter.
CREATE OR REPLACE FUNCTION public.allocate_invoice_code(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_number integer;
  v_prefix text;
  v_padding integer;
  v_code text;
  v_attempt integer;
BEGIN
  INSERT INTO public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
  VALUES (p_tenant_id, 'invoice', 'HD', 0, 6)
  ON CONFLICT (tenant_id, entity_type) DO NOTHING;

  SELECT current_number, prefix, padding INTO v_number, v_prefix, v_padding
  FROM public.code_sequences
  WHERE tenant_id = p_tenant_id AND entity_type = 'invoice'
  FOR UPDATE;

  IF v_prefix IS DISTINCT FROM 'HD' OR v_padding IS DISTINCT FROM 6
     OR v_number IS NULL OR v_number < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'INVOICE_CODE_SERIES_INVALID';
  END IF;

  FOR v_attempt IN 1..1000 LOOP
    IF v_number = 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'INVOICE_CODE_SERIES_EXHAUSTED';
    END IF;
    v_number := v_number + 1;
    v_code := 'HD' || lpad(v_number::text, greatest(6, length(v_number::text)), '0');
    IF NOT EXISTS (
      SELECT 1 FROM public.invoices WHERE tenant_id = p_tenant_id AND code = v_code
    ) THEN
      UPDATE public.code_sequences SET current_number = v_number
      WHERE tenant_id = p_tenant_id AND entity_type = 'invoice';
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'INVOICE_CODE_COLLISION_LIMIT';
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_code(uuid) FROM PUBLIC;

-- Patch only the invoice branch, retaining concurrent fixes to all other series.
DO $$
DECLARE
  v_definition text;
  v_marker text := '  UPDATE public.code_sequences';
  v_branch text := E'  IF p_entity_type = ''invoice'' THEN\n    RETURN public.allocate_invoice_code(p_tenant_id);\n  END IF;\n\n';
BEGIN
  SELECT replace(pg_get_functiondef('public.next_code(uuid,text)'::regprocedure), E'\r\n', E'\n')
  INTO v_definition;
  IF position('RETURN public.allocate_invoice_code(p_tenant_id);' IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position('p_entity_type' IN v_definition) = 0
     OR position('next_cash_code' IN v_definition) = 0
     OR (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker) <> 1 THEN
    RAISE EXCEPTION 'next_code definition changed; review before applying invoice guard';
  END IF;
  EXECUTE replace(v_definition, v_marker, v_branch || v_marker);
END;
$$;

COMMIT;
