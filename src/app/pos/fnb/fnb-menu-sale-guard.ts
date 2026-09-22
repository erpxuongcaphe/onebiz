/**
 * Chốt giao diện trước khi món được thêm nhanh vào giỏ.
 *
 * Máy chủ vẫn là lớp quyết định cuối (00330). Chốt này chỉ ngăn thu ngân
 * tạo giỏ chắc chắn sẽ bị từ chối ở bước gửi bếp khi dữ liệu cấu hình chưa xong.
 */
export function kiemTraGiaBanThemNhanhFnb(input: {
  catalogPrice: number | null | undefined;
  resolvedPrice: number | null | undefined;
  allowFreeSale?: boolean;
}): { dat: true } | { dat: false; lyDo: string } {
  const catalogPrice = Number(input.catalogPrice);
  const explicitlyFree = input.allowFreeSale === true && catalogPrice === 0;
  if (!Number.isFinite(catalogPrice) || catalogPrice < 0 || (catalogPrice === 0 && !explicitlyFree)) {
    return {
      dat: false,
      lyDo: "Món chưa có giá bán. Nhập giá trước khi thêm vào giỏ.",
    };
  }

  const resolvedPrice = Number(input.resolvedPrice);
  if (!Number.isFinite(resolvedPrice) || resolvedPrice < 0 || (resolvedPrice === 0 && !explicitlyFree)) {
    return {
      dat: false,
      lyDo: "Giá bán của kênh hiện tại chưa hợp lệ. Kiểm tra lại giá trước khi bán.",
    };
  }

  return { dat: true };
}
