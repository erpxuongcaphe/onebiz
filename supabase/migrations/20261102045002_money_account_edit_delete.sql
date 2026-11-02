-- Correct account codes without changing UUIDs; delete unused setup mistakes only.
begin;
create or replace function public.save_money_account(p_id uuid,p_expected_revision integer,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; a public.money_accounts%rowtype; old_row jsonb; b uuid; op_date date; op_amount numeric;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),'finance.void_transaction'),false) then raise exception 'MONEY_ACCOUNT_MANAGE_DENIED' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'MONEY_ACCOUNT_REASON_REQUIRED' using errcode='22023'; end if;
 b:=(p_payload->>'branchId')::uuid;
 if not exists(select 1 from public.branches where id=b and tenant_id=t)
  or not coalesce(public.user_has_branch_access(auth.uid(),b),false) then raise exception 'MONEY_ACCOUNT_BRANCH_DENIED' using errcode='42501'; end if;
 op_date:=nullif(p_payload->>'openingDate','')::date; op_amount:=nullif(p_payload->>'openingAmount','')::numeric;
 if (op_date is null)<>(op_amount is null) or not coalesce(isfinite(op_date),true)
  or op_date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'MONEY_ACCOUNT_OPENING_INVALID' using errcode='22023'; end if;
 if p_id is not null then
  select * into a from public.money_accounts where id=p_id and tenant_id=t for update;
  if not found or not coalesce(public.user_has_branch_access(auth.uid(),a.branch_id),false) then raise exception 'MONEY_ACCOUNT_NOT_FOUND' using errcode='42501'; end if;
  if a.revision is distinct from p_expected_revision then raise exception 'MONEY_ACCOUNT_CHANGED_RELOAD' using errcode='PT409'; end if;
  if a.branch_id<>b or a.kind is distinct from p_payload->>'kind' then raise exception 'MONEY_ACCOUNT_IDENTITY_IMMUTABLE' using errcode='22023'; end if;
  old_row:=to_jsonb(a);
  update public.money_accounts set code=upper(btrim(p_payload->>'code')), name=btrim(p_payload->>'name'), bank_name=nullif(btrim(p_payload->>'bankName'),''),
   account_number=nullif(btrim(p_payload->>'accountNumber'),''),account_holder=nullif(btrim(p_payload->>'accountHolder'),''),
   active=coalesce((p_payload->>'active')::boolean,true),opening_date=op_date,opening_amount=op_amount,
   revision=revision+1,updated_at=now() where id=p_id returning * into a;
 else
  insert into public.money_accounts(tenant_id,branch_id,code,name,kind,bank_name,account_number,account_holder,opening_date,opening_amount,created_by)
  values(t,b,upper(btrim(p_payload->>'code')),btrim(p_payload->>'name'),p_payload->>'kind',nullif(btrim(p_payload->>'bankName'),''),
   nullif(btrim(p_payload->>'accountNumber'),''),nullif(btrim(p_payload->>'accountHolder'),''),op_date,op_amount,auth.uid()) returning * into a;
 end if;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(t,auth.uid(),'money_account_saved','money_account',a.id,old_row,to_jsonb(a)||jsonb_build_object('reason',btrim(p_reason)));
 return to_jsonb(a);
end; $$;


create or replace function public.delete_money_account(p_id uuid,p_expected_revision integer,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid; a public.money_accounts%rowtype;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),'finance.void_transaction'),false) then
  raise exception 'MONEY_ACCOUNT_MANAGE_DENIED' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 then
  raise exception 'MONEY_ACCOUNT_REASON_REQUIRED' using errcode='22023'; end if;
 select * into a from public.money_accounts where id=p_id and tenant_id=t for update;
 if not found or not coalesce(public.user_has_branch_access(auth.uid(),a.branch_id),false) then
  raise exception 'MONEY_ACCOUNT_NOT_FOUND' using errcode='42501'; end if;
 if a.revision is distinct from p_expected_revision then
  raise exception 'MONEY_ACCOUNT_CHANGED_RELOAD' using errcode='PT409'; end if;
 if coalesce(a.opening_amount,0)<>0 then
  raise exception 'MONEY_ACCOUNT_HAS_OPENING_BALANCE' using errcode='22023'; end if;
 -- Every existing FK (including COD links) protects historical references.
 -- Row lock serializes deletion with concurrent posting and editing.
 begin
  delete from public.money_accounts where id=a.id;
 exception when foreign_key_violation then
  raise exception 'MONEY_ACCOUNT_IN_USE' using errcode='22023';
 end;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(t,auth.uid(),'money_account_deleted','money_account',a.id,to_jsonb(a),
  jsonb_build_object('reason',btrim(p_reason)));
 return a.id;
end; $$;
revoke all on function public.delete_money_account(uuid,integer,text) from public,anon;
grant execute on function public.delete_money_account(uuid,integer,text) to authenticated;

commit;
