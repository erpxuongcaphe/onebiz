begin transaction read only;

select 'P1_00357_RPC_SAN_SANG'::text as muc,
       'DIEU_KIEN'::text as loai,
       to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null as dat,
       jsonb_build_object(
         'ham_luu_size', to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is not null
       ) as chi_tiet
union all
select 'P2_00366_CHUA_CAI',
       'DIEU_KIEN',
       to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is null,
       jsonb_build_object(
         'ham_nen_00357_da_co', to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is not null
       );

rollback;
