-- Minimal AUTHORIZATION CONTRACTS, not copies of private production RPC bodies.
-- The six private implementations are listed in supabase/contracts/private-rpcs.json.
-- Local acceptance additionally exercises their read-only exported definitions.
create function get_document_payment_history_scoped(p_reference_type text,p_reference_id uuid,p_offset integer default 0,p_limit integer default 500)
returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();v_branch uuid;begin
 select branch_id into v_branch from invoices where id=p_reference_id;
 if not public.user_has_permission(v_actor,'pos_fnb.checkout') then raise exception 'PAYMENT_HISTORY_DENIED';end if;
 return '{}'::jsonb;end$$;
create function get_open_shift_status_scoped(p_branch_id uuid) returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();begin
 if not public.user_has_permission(v_actor,'pos_fnb.checkout') then raise exception 'SHIFT_STATUS_DENIED';end if;
 return '{}'::jsonb;end$$;
create function get_pos_customer_contacts_scoped(p_branch_id uuid,p_search text default null,p_customer_id uuid default null,p_internal boolean default false,p_limit integer default 10)
returns jsonb language plpgsql as $$declare actor uuid:=auth.uid();begin
 if not public.user_has_permission(actor,'pos_fnb.checkout') then raise exception 'POS_CONTACT_PERMISSION_DENIED';end if;
 return '[]'::jsonb;end$$;
create function get_shift_context_scoped(p_shift_id uuid) returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();v_shift shifts;begin
 select * into v_shift from shifts where id=p_shift_id;
 if not public.user_has_permission(v_actor,'pos_fnb.checkout') then raise exception 'SHIFT_CONTEXT_DENIED';end if;
 return '{}'::jsonb;end$$;
create function get_shift_records_scoped(p_kind text,p_branch_id uuid default null,p_offset integer default 0,p_limit integer default 200)
returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();begin
 if not public.user_has_permission(v_actor,'pos_fnb.checkout') then raise exception 'SHIFT_RECORDS_DENIED';end if;
 return '{}'::jsonb;end$$;
create function open_shift_operational(p_branch_id uuid,p_starting_cash numeric default 0,p_channel text default 'fnb')
returns jsonb language plpgsql as $$declare v_actor uuid:=auth.uid();begin
 if not public.user_has_permission(v_actor,case p_channel when 'fnb' then 'pos_fnb.checkout' else 'pos_retail.checkout' end) then raise exception 'SHIFT_OPEN_DENIED';end if;
 return public.fnb_open_shift_atomic(p_branch_id,p_starting_cash);end$$;
