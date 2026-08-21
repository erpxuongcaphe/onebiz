/**
 * Chuyển đổi TAB HÓA ĐƠN của POS Retail — phần thuần, không React.
 *
 * VÌ SAO TÁCH RA: mỗi tab là một hóa đơn độc lập, nên giỏ hàng, phiên tự lưu
 * VÀ ngày hóa đơn đều phải đi theo tab. Trước 00335 ngày hóa đơn nằm ở state
 * toàn trang — chỉnh ngày ở tab A thì tab B lĩnh luôn. Đó là lỗi tính tiền
 * sai kỳ, không phải lỗi giao diện.
 *
 * Gom phép biến đổi vào đây để kiểm được bằng HÀNH VI (dựng tab thật, chuyển
 * qua lại, đọc kết quả) thay vì quét chuỗi trong tệp 5.500 dòng.
 *
 * Quy ước (giữ nguyên từ bản cũ): tab ĐANG HOẠT ĐỘNG có `snapshot === null` vì
 * sự thật nằm ở `usePosState`; các trường `ngayHoaDon`/`lyDoNgayHoaDon` của nó
 * cũng vô nghĩa vì sự thật nằm ở state trang. Hai giá trị đó chỉ được cất vào
 * bản ghi tab khi tab RỜI vị trí hoạt động.
 */

export interface TabHoaDon {
  id: string;
  snapshot: unknown | null;
  itemCount: number;
  /** Phiên tự lưu / chống trùng của riêng tab. */
  sessionId: string;
  ngayHoaDon: string | null;
  lyDoNgayHoaDon: string;
}

/** Trạng thái của tab đang rời đi, do trang cung cấp. */
export interface TrangThaiDiRa {
  snapshot: unknown | null;
  itemCount: number;
  ngayHoaDon: string | null;
  lyDoNgayHoaDon: string;
}

export interface KetQuaChuyenTab<T extends TabHoaDon> {
  tabs: T[];
  tabHoatDong: string;
  /** snapshot cần khôi phục vào giỏ; null ⇒ làm trống giỏ. */
  snapshotVao: unknown | null;
  /** Ngày hóa đơn của tab đi vào. */
  ngayHoaDon: string | null;
  lyDoNgayHoaDon: string;
}

/** Cất trạng thái của tab đang hoạt động vào bản ghi của chính nó. */
function catTabDiRa<T extends TabHoaDon>(tab: T, diRa: TrangThaiDiRa): T {
  return {
    ...tab,
    snapshot: diRa.snapshot,
    itemCount: diRa.itemCount,
    ngayHoaDon: diRa.ngayHoaDon,
    lyDoNgayHoaDon: diRa.lyDoNgayHoaDon,
  };
}

/**
 * Chuyển sang một tab khác.
 * Trả về null khi không có gì để làm (bấm đúng tab đang mở, hoặc id lạ) —
 * trang giữ nguyên mọi thứ, không đụng giỏ.
 */
export function chuyenTab<T extends TabHoaDon>(
  tabs: T[],
  idDangHoatDong: string,
  idMuonSang: string,
  diRa: TrangThaiDiRa,
): KetQuaChuyenTab<T> | null {
  if (idMuonSang === idDangHoatDong) return null;
  const tabVao = tabs.find((t) => t.id === idMuonSang);
  if (!tabVao) return null;

  return {
    tabs: tabs.map((tab) => {
      if (tab.id === idDangHoatDong) return catTabDiRa(tab, diRa);
      if (tab.id === idMuonSang) return { ...tab, snapshot: null };
      return tab;
    }),
    tabHoatDong: idMuonSang,
    snapshotVao: tabVao.snapshot,
    ngayHoaDon: tabVao.ngayHoaDon,
    lyDoNgayHoaDon: tabVao.lyDoNgayHoaDon,
  };
}

/**
 * Mở tab mới. Tab mới LUÔN bắt đầu ở chế độ tự động (ngayHoaDon = null) ⇒ hiện
 * đúng thời điểm hiện tại của chính nó, không kế thừa ngày đã chỉnh ở tab khác.
 */
export function themTab<T extends TabHoaDon>(
  tabs: T[],
  idDangHoatDong: string,
  diRa: TrangThaiDiRa,
  tabMoi: T,
): KetQuaChuyenTab<T> {
  const moi: T = { ...tabMoi, snapshot: null, ngayHoaDon: null, lyDoNgayHoaDon: "" };
  return {
    tabs: [
      ...tabs.map((tab) => (tab.id === idDangHoatDong ? catTabDiRa(tab, diRa) : tab)),
      moi,
    ],
    tabHoatDong: moi.id,
    snapshotVao: null,
    ngayHoaDon: null,
    lyDoNgayHoaDon: "",
  };
}

/**
 * Đóng một tab.
 * · Đóng tab KHÔNG hoạt động ⇒ chỉ bỏ khỏi danh sách, giỏ và ngày giữ nguyên
 *   (trả `snapshotVao`/`ngayHoaDon` của chính tab đang hoạt động không có ý
 *   nghĩa nên trường `tabHoatDong` giữ nguyên và cờ `doiTabHoatDong` = false).
 * · Đóng tab ĐANG hoạt động ⇒ tab kế bên tiếp quản, mang theo ĐÚNG ngày hóa
 *   đơn đã cất của chính nó.
 * Trả null khi chỉ còn 1 tab (không cho đóng tab cuối).
 */
export function dongTab<T extends TabHoaDon>(
  tabs: T[],
  idDong: string,
  idDangHoatDong: string,
): (KetQuaChuyenTab<T> & { doiTabHoatDong: boolean }) | null {
  if (tabs.length <= 1) return null;
  const conLai = tabs.filter((t) => t.id !== idDong);
  if (conLai.length === tabs.length) return null; // id lạ

  if (idDong !== idDangHoatDong) {
    return {
      tabs: conLai,
      tabHoatDong: idDangHoatDong,
      snapshotVao: null,
      ngayHoaDon: null,
      lyDoNgayHoaDon: "",
      doiTabHoatDong: false,
    };
  }

  const viTriDong = tabs.findIndex((t) => t.id === idDong);
  const tabKeNhiem = conLai[Math.min(viTriDong, conLai.length - 1)];
  return {
    tabs: conLai.map((tab) =>
      tab.id === tabKeNhiem.id ? { ...tab, snapshot: null } : tab,
    ),
    tabHoatDong: tabKeNhiem.id,
    snapshotVao: tabKeNhiem.snapshot,
    ngayHoaDon: tabKeNhiem.ngayHoaDon,
    lyDoNgayHoaDon: tabKeNhiem.lyDoNgayHoaDon,
    doiTabHoatDong: true,
  };
}

/**
 * Đổi chi nhánh: mọi giỏ bị làm trống ⇒ ngày hóa đơn đã chỉnh của TỪNG tab
 * cũng phải trả về tự động, không để ngày của chi nhánh cũ đi theo.
 */
export function doiChiNhanh<T extends TabHoaDon>(
  tabs: T[],
  phienMoi: () => string,
): T[] {
  return tabs.map((tab) => ({
    ...tab,
    snapshot: null,
    itemCount: 0,
    sessionId: phienMoi(),
    ngayHoaDon: null,
    lyDoNgayHoaDon: "",
  }));
}
