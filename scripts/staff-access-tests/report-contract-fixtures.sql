-- Minimal private authorization contracts, NOT private business implementations.
-- Local acceptance also loads the actual read-only exported definitions.
create function public.get_company_cash_receipt_audit_v1(p_branch uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer as $$declare v_actor uuid:=auth.uid();begin
 if not public.user_has_permission(v_actor,'pos_fnb.view_sales_summary') then raise exception 'REPORT_DENIED' using errcode='42501';end if;return '{}';end$$;
create function public.get_store_sales_day_collections(p_branch_id uuid,p_sales_date date)
returns jsonb language plpgsql security definer as $$declare v_actor uuid:=auth.uid();begin
 if not public.user_has_permission(v_actor,'pos_fnb.view_sales_summary') then raise exception 'REPORT_DENIED' using errcode='42501';end if;return '{}';end$$;
create function public.report_cogs_by_bom(p_from_date date,p_to_date date,p_branch_id uuid default null)
returns table(invoice_id uuid,invoice_code text,invoice_date timestamptz,branch_id uuid,branch_name text,product_id uuid,product_code text,product_name text,qty_sold numeric,revenue numeric,cogs_real numeric,margin numeric)
language plpgsql security definer as $$begin
 if not public.user_has_permission(auth.uid(),'reports.analytics') or not public.user_has_permission(auth.uid(),'reports.view_profit')
 then raise exception 'REPORT_DENIED' using errcode='42501';end if;return;end$$;
create function public.get_delivery_invoice_management_v1(p_branch_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer as $$declare actor uuid:=auth.uid();begin
 if not public.user_has_permission(actor,'reports.view_detail') or not
 (public.user_has_permission(actor,'reports.fnb') or public.user_has_permission(actor,'reports.analytics'))
 then raise exception 'DELIVERY_REPORT_DENIED' using errcode='42501';end if;return '{}';end$$;
create function public.get_store_direct_bank_cash_links(p_cash_ids uuid[],p_export boolean default false)
returns jsonb language plpgsql security definer as $$declare v_actor uuid:=auth.uid();begin
 if not public.user_has_permission(v_actor,'reports.analytics') or (p_export and
 (not public.user_has_permission(v_actor,'reports.export') or not public.user_has_permission(v_actor,'reports.export_detail')))
 then raise exception 'REPORT_DENIED' using errcode='42501';end if;return '{}';end$$;
create function public.get_store_finance_reporting_source(p_mode text,p_from date,p_to date,p_branch uuid default null,p_legal_key text default null,p_export boolean default false)
returns jsonb language plpgsql security definer as $$declare v_actor uuid:=auth.uid();begin
 if not public.user_has_permission(v_actor,'reports.analytics') or not public.user_has_permission(v_actor,'reports.view_detail')
 or not public.user_has_permission(v_actor,'reports.view_profit') or (p_export and
 (not public.user_has_permission(v_actor,'reports.export') or not public.user_has_permission(v_actor,'reports.export_detail')))
 then raise exception 'REPORT_DENIED' using errcode='42501';end if;return '{}';end$$;
