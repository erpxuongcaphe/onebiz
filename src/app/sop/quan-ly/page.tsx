// Day 5 16/05/2026: SOP cho Quản lý quán (Manager) — thuần Vietnamese.

export default function SopManagerPage() {
  return (
    <div>
      <header className="header">
        <div>
          <h1>Quy trình tác nghiệp — Quản lý quán</h1>
          <p className="role">Áp dụng tại 3 quán Cà Phê OneBiz • Ban hành 16/05/2026</p>
        </div>
        <div className="role">
          <b>OneBiz</b> · Tài liệu nội bộ
        </div>
      </header>

      <p>
        Vai trò của bạn là giám sát toàn bộ ca trực — đảm bảo nhân viên làm đúng quy
        trình, xử lý sự cố, duyệt các thao tác nhạy cảm (giảm giá / huỷ bill), cuối
        ngày tổng kết và đối chiếu thực thu.
      </p>

      <section>
        <h2>1. Đầu ngày — Mở quán</h2>
        <ol>
          <li>
            Đến quán trước nhân viên <b>15 phút</b>. Kiểm tra cửa, két tiền, hệ
            thống điện nước, hệ thống POS.
          </li>
          <li>
            Mở két chính → kiểm tra tiền lẻ đầy đủ cho tất cả mệnh giá. Bổ sung nếu
            thiếu.
          </li>
          <li>
            Đăng nhập tài khoản quản lý → vào <b>Tổng quan</b> → kiểm tra KPI hôm
            qua:
            <ul>
              <li>Doanh thu so với cùng kỳ tuần trước.</li>
              <li>Số đơn huỷ — nếu &gt; 5 đơn → cần xem lại lý do.</li>
              <li>Cảnh báo tồn kho dưới ngưỡng — báo nhập hàng.</li>
            </ul>
          </li>
          <li>
            Họp 5 phút với nhân viên ca sáng — thông báo món hết, khuyến mãi đang
            chạy, lưu ý đặc biệt (VIP đặt bàn, sự kiện).
          </li>
          <li>
            Kiểm tra cuộn giấy in, mực — bổ sung trước giờ đông.
          </li>
        </ol>
      </section>

      <section>
        <h2>2. Trong ca — Giám sát + Duyệt OTP</h2>
        <h3>Khi nhân viên xin OTP qua điện thoại / Zalo</h3>
        <ol>
          <li>
            Mở web/PWA <code>onebiz.com.vn/cap-otp</code> trên điện thoại của bạn.
            Đăng nhập tài khoản quản lý.
          </li>
          <li>
            Chọn đúng hành động cần duyệt:
            <ul>
              <li>
                <b>Huỷ bill chưa thu tiền</b> — đơn bếp đã làm nhưng khách đổi ý /
                vào nhầm món.
              </li>
              <li>
                <b>Huỷ bill đã thu tiền</b> — khách trả lại + hoàn tiền (hoàn kho +
                phiếu chi).
              </li>
              <li>
                <b>Giảm giá thủ công</b> — KH thân quen / khiếu nại / khắc phục lỗi
                bếp.
              </li>
              <li>
                <b>Xoá khách hàng / NCC</b> — chỉ khi chắc chắn không còn ràng buộc
                công nợ.
              </li>
            </ul>
          </li>
          <li>
            Hệ thống tạo mã 6 số — hiệu lực <b>2 phút</b>. Đọc cho cashier qua điện
            thoại — không gửi qua tin nhắn / chat.
          </li>
          <li>
            Sau khi cashier dùng — bạn nhận thông báo audit log đã ghi nhận với
            danh tính bạn + lý do. Có thể kiểm tra tại trang{" "}
            <b>Quản lý → OTP gần đây</b>.
          </li>
        </ol>

        <h3>Khi khách phàn nàn</h3>
        <ol>
          <li>
            Lắng nghe khách — không tranh cãi. Xin lỗi ngay kể cả khi chưa rõ lỗi
            phía nào.
          </li>
          <li>
            Đưa ra hướng xử lý: làm lại miễn phí / giảm giá / mời món miễn phí. Tự
            quyết định trong ngưỡng được uỷ quyền.
          </li>
          <li>
            Ghi nhận sự cố vào file Excel báo cáo tuần — kèm hình ảnh nếu có.
          </li>
          <li>
            Nếu vượt ngưỡng uỷ quyền (vd khách yêu cầu bồi thường &gt; 1tr) — gọi
            chủ quán ngay.
          </li>
        </ol>

        <h3>Khi phát hiện vấn đề kho / thiết bị</h3>
        <ul>
          <li>
            Hàng sắp hết → kiểm tra trang <b>Kho → Báo cáo XNT</b> để biết mức tồn
            thực + dự đoán hết. Nếu thấp → đặt hàng nhập.
          </li>
          <li>
            Phát hiện <b>drift kho</b> (sản phẩm hệ thống ghi 50 nhưng đếm thực 47) →
            tạo phiếu <b>Kiểm kê kho</b> → ghi nhận thực tế → tạo phiếu xuất hủy
            phần lệch (nếu là mất / hỏng) hoặc nhập điều chỉnh.
          </li>
          <li>
            Thiết bị hỏng (máy pha, lò nướng, máy in) → gọi kỹ thuật theo số đường
            dây nóng. Trong khi đợi → tạm tắt menu liên quan trên POS.
          </li>
        </ul>
      </section>

      <section className="warn">
        <h2>3. Cuối ngày — Đóng quán + Đối chiếu</h2>
        <ol>
          <li>
            Sau khi cashier đóng ca cuối — kiểm tra số tiền mặt thực giao về có
            khớp biên bản đóng ca không. Nếu lệch &gt; 5.000đ → điều tra:
            <ul>
              <li>Mở <b>Lịch sử đơn F&B</b> rà các đơn tiền mặt trong ca.</li>
              <li>
                Mở <b>Sổ quỹ</b> kiểm tra các phiếu chi không liên quan đến đơn
                (chi vặt, mua hàng nhanh).
              </li>
              <li>
                Mở <b>Audit log</b> ở góc <i>Cài đặt → Hệ thống</i> để xem các thao
                tác sửa / huỷ trong ca.
              </li>
            </ul>
          </li>
          <li>
            Kiểm tra báo cáo cuối ngày trên{" "}
            <code>onebiz.com.vn/phan-tich/cuoi-ngay</code>:
            <ul>
              <li>Tổng doanh thu = Tiền mặt + Chuyển khoản + Tip.</li>
              <li>
                Số đơn huỷ ngày — đặc biệt chú ý đơn đã thanh toán (đỏ trong báo
                cáo) — phải có lý do rõ ràng.
              </li>
              <li>
                Top sản phẩm bán chạy → đối chiếu với tồn nguyên liệu (giảm tương
                ứng?).
              </li>
            </ul>
          </li>
          <li>
            Xuất báo cáo Excel cuối ngày + đối chiếu sổ quỹ → gửi chủ quán qua Zalo
            trước <b>23h59</b>.
          </li>
          <li>
            Khoá két tiền — chỉ giữ tiền lẻ đầu ca cho ngày mai. Tiền doanh thu lớn
            mang về kho an toàn / nộp ngân hàng theo quy định.
          </li>
          <li>
            Tắt thiết bị không cần thiết (đèn quầy, máy lạnh, máy in). Bật chế độ
            tiết kiệm điện ban đêm.
          </li>
        </ol>
      </section>

      <section>
        <h2>4. Hàng tuần — Báo cáo + Kiểm kê</h2>
        <ol>
          <li>
            <b>Thứ 2 đầu tuần</b>: Họp đầu tuần với chủ quán — báo cáo doanh thu
            tuần trước, đề xuất khuyến mãi tuần này.
          </li>
          <li>
            <b>Thứ 6 cuối tuần</b>: Kiểm kê kho hàng — vật tư, nguyên liệu, máy
            móc. Đối chiếu sổ vs thực tế. Tạo phiếu kiểm kê trên hệ thống.
          </li>
          <li>
            <b>Cuối tháng</b>: Đối chiếu công nợ với NCC. Kiểm tra các đơn nhập
            chưa thanh toán hết (status=partial) → đề nghị NCC gửi đối soát.
          </li>
        </ol>
      </section>

      <section className="tip">
        <h2>5. Quy tắc nội bộ</h2>
        <ul>
          <li>
            <b>OTP là chữ ký số của bạn</b> — không bao giờ ấn duyệt khi không hiểu
            rõ thao tác. Hỏi lại cashier qua điện thoại trước khi cấp.
          </li>
          <li>
            <b>Không giữ tiền mặt cá nhân chung két tiền quán</b> — két chỉ chứa
            tiền của quán.
          </li>
          <li>
            <b>Không sửa giá / khuyến mãi trực tiếp trên POS khi đang bán</b> — chỉ
            sửa khi quán đóng cửa hoặc thông qua quy trình duyệt chính thức.
          </li>
          <li>
            <b>Không nhận thanh toán giúp khách qua tài khoản cá nhân</b> — mọi
            chuyển khoản phải qua tài khoản quán.
          </li>
          <li>
            <b>Bảo mật mã PIN / mật khẩu</b> — không gửi qua chat / tin nhắn. Đổi
            ngay khi nghi ngờ bị lộ.
          </li>
          <li>
            <b>Báo cáo bất thường ngay</b> — drift kho, audit log có thao tác lạ,
            nhân viên có hành vi nghi vấn (huỷ bill nhiều lần liên tiếp, sửa tiền
            thừa) → báo chủ quán ngay, không tự xử lý.
          </li>
        </ul>
      </section>

      <div className="footer">
        Tài liệu này dành cho quản lý quán — chỉ chia sẻ trong nhóm Zalo
        &quot;OneBiz — Quản lý&quot;. Cập nhật mới nhất tại{" "}
        <code>onebiz.com.vn/sop/quan-ly</code>. Đề xuất chỉnh sửa qua chủ quán.
      </div>
    </div>
  );
}
