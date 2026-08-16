-- ============================================================================
-- ROLLBACK 00329 — bỏ lớp bọc, trả hàm huỷ về đúng bản 00165 như trước
--
-- Chỉ khôi phục MÃ HÀM. Không sửa một dòng dữ liệu nghiệp vụ nào: tồn kho,
-- sổ lô, hoá đơn, tiền hoàn, nhật ký đều giữ nguyên. Những lần huỷ đã chạy qua
-- lớp bọc vẫn giữ kết quả đối soát lô của chúng — đó là dữ liệu đúng.
--
-- Sau khi lui: sổ lô lại không được đảo cho nguyên liệu / topping khi huỷ.
-- ============================================================================

do $$
begin
  if to_regprocedure('public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is null then
    raise notice 'Rollback 00329: khong thay ham noi bo — co le 00329 chua chay. Khong lam gi.';
    return;
  end if;

  -- Bỏ lớp bọc rồi trả hàm nội bộ về tên cũ.
  execute 'drop function if exists public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)';
  execute 'alter function public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'
       || ' rename to fnb_void_invoice_atomic';

  execute 'revoke all on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) from public, anon';
  execute 'grant execute on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) to authenticated';

  raise notice 'Rollback 00329: da tra ham huy ve ban 00165, khong doi du lieu';
end $$;

do $$
begin
  if to_regprocedure('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is null then
    raise exception 'Rollback 00329 that bai: khong con ham fnb_void_invoice_atomic';
  end if;
  if to_regprocedure('public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is not null then
    raise exception 'Rollback 00329 that bai: ham noi bo van con';
  end if;
end $$;
