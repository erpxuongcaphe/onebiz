BEGIN;

-- New bills, including split children, share the KB series. Historical codes
-- and parent_order_id are deliberately preserved.
CREATE OR REPLACE FUNCTION public.allocate_kitchen_order_code(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_number integer;
  v_prefix text;
  v_padding integer;
  v_code text;
  v_attempt integer;
BEGIN
  INSERT INTO public.code_sequences(tenant_id, entity_type, prefix, current_number, padding)
  VALUES(p_tenant_id, 'kitchen_order', 'KB', 0, 6)
  ON CONFLICT(tenant_id, entity_type) DO NOTHING;
  SELECT current_number, prefix, padding INTO v_number, v_prefix, v_padding
  FROM public.code_sequences
  WHERE tenant_id = p_tenant_id AND entity_type = 'kitchen_order'
  FOR UPDATE;
  IF v_prefix IS DISTINCT FROM 'KB' OR v_padding IS DISTINCT FROM 6
     OR v_number IS NULL OR v_number < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'KITCHEN_CODE_SERIES_INVALID';
  END IF;
  FOR v_attempt IN 1..1000 LOOP
    IF v_number = 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'KITCHEN_CODE_SERIES_EXHAUSTED';
    END IF;
    v_number := v_number + 1;
    v_code := 'KB' || lpad(v_number::text, greatest(6, length(v_number::text)), '0');
    IF NOT EXISTS(SELECT 1 FROM public.kitchen_orders
                  WHERE tenant_id = p_tenant_id AND order_number = v_code) THEN
      UPDATE public.code_sequences SET current_number = v_number
      WHERE tenant_id = p_tenant_id AND entity_type = 'kitchen_order';
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'KITCHEN_CODE_COLLISION_LIMIT';
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_kitchen_order_code(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_definition text;
  v_marker text := '  UPDATE public.code_sequences';
  v_branch text := E'  IF p_entity_type = ''kitchen_order'' THEN\n    RETURN public.allocate_kitchen_order_code(p_tenant_id);\n  END IF;\n\n';
  v_old text := E'    v_child_number := v_order.order_number || ''-'' ||\n      case\n        when v_existing_children + v_child_index + 1 <= 26\n          then chr(64 + v_existing_children + v_child_index + 1)\n        else ''P'' || (v_existing_children + v_child_index + 1)::text\n      end;';
BEGIN
  SELECT replace(pg_get_functiondef('public.next_code(uuid,text)'::regprocedure), E'\r\n', E'\n') INTO v_definition;
  IF position('RETURN public.allocate_kitchen_order_code(p_tenant_id);' IN v_definition) = 0 THEN
    IF (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker) <> 1 THEN
      RAISE EXCEPTION 'next_code changed; review kitchen allocation patch';
    END IF;
    EXECUTE replace(v_definition, v_marker, v_branch || v_marker);
  END IF;

  SELECT replace(pg_get_functiondef('public.split_kitchen_order_atomic(uuid,text,uuid[],integer)'::regprocedure), E'\r\n', E'\n') INTO v_definition;
  IF position('v_child_number := public.next_code(v_order.tenant_id, ''kitchen_order'');' IN v_definition) = 0 THEN
    IF (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'split function changed; review sequential code patch';
    END IF;
    EXECUTE replace(v_definition, v_old, '    v_child_number := public.next_code(v_order.tenant_id, ''kitchen_order'');');
  END IF;
END;
$$;

COMMIT;
