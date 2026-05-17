// Day 5 16/05/2026: SOP cho Thu ngân (Cashier) — thuần Vietnamese.

export default function SopCashierPage() {
  return (
    <div>
      <header className="header">
        <div>
          <h1>Quy trình tác nghiệp — Thu ngân</h1>
          <p className="role">Áp dụng tại 3 quán Cà Phê OneBiz • Ban hành 16/05/2026</p>
        </div>
        <div className="role">
          <b>OneBiz</b> · Tài liệu nội bộ
        </div>
      </header>

      <p>
        Vai trò của bạn là người tiếp xúc trực tiếp với khách — đứng quầy, nhận đơn,
        ghi nhận thanh toán, in hoá đơn và giao bill cho khách. Bạn chịu trách nhiệm
        chính về độ chính xác của tiền vào — tiền ra trong ca trực.
      </p>

      <section>
        <h2>1. Trước ca — Mở ca</h2>
        <ol>
          <li>
            Đến quán trước giờ mở cửa <b>15 phút</b>. Đăng nhập tài khoản của bạn
            trên máy POS bằng tên/mã PIN cá nhân (không dùng chung tài khoản với ai
            khác).
          </li>
          <li>
            Đếm tiền lẻ trong két (mệnh giá 1k / 2k / 5k / 10k / 20k / 50k). Nhập
            đúng số tiền đang có vào ô <b>&quot;Tiền mặt đầu ca&quot;</b> khi nhấn{" "}
            <b>Mở ca</b>. Ghi sai → công ty không hoàn được khoản chênh.
          </li>
          <li>
            Kiểm tra máy in bill — đặt cuộn giấy đầy. In thử 1 bill trắng bằng nút{" "}
            <b>In thử</b> trong Cài đặt → In ấn.
          </li>
          <li>
            Kiểm tra kết nối mạng. Nếu hệ thống báo <i>Đang ngoại tuyến</i> — vẫn
            bán được nhưng chỉ tiền mặt, không quẹt thẻ. Báo quản lý nếu mất mạng
            quá 30 phút.
          </li>
        </ol>
      </section>

      <section>
        <h2>2. Trong ca — Bán hàng</h2>
        <h3>Quy trình ghi nhận đơn</h3>
        <ol>
          <li>
            Khi khách gọi món → bấm chọn món trên máy POS. Có thể chạm vào ảnh hoặc
            tìm kiếm theo tên. Số lượng mặc định là 1, dùng nút <b>+/-</b> để chỉnh.
          </li>
          <li>
            Nếu có biến thể (size lớn / nhỏ, đá nhiều / ít) → bấm vào món để mở
            dialog chọn biến thể trước khi thêm vào giỏ.
          </li>
          <li>
            Hỏi khách <b>&quot;Tại quán hay mang về?&quot;</b> → chọn đúng loại đơn ở
            cart pill row (Tại quán / Mang về / Giao hàng).
          </li>
          <li>
            Hỏi tên khách quen → tìm trong ô khách hàng. Khách mới chỉ cần &quot;Khách
            lẻ&quot; là đủ — đừng hỏi số điện thoại nếu khách không tự đưa.
          </li>
        </ol>

        <h3>Quy trình thu tiền</h3>
        <ol>
          <li>
            Báo tổng tiền rõ ràng cho khách. Hỏi <b>&quot;Anh/chị thanh toán bằng
            tiền mặt hay chuyển khoản?&quot;</b>.
          </li>
          <li>
            Nếu chuyển khoản — bấm <b>Chuyển khoản</b> → mã QR VietQR xuất hiện trên
            màn hình + in trên bill (nếu bật). Đợi khách báo &quot;Đã chuyển&quot;
            và xác nhận bằng tin nhắn ngân hàng/Sacombank Pay vào máy quản lý.{" "}
            <b>Không bấm Hoàn tất khi chưa thấy tiền về.</b>
          </li>
          <li>
            Nếu tiền mặt — nhập số tiền khách đưa → POS tự tính tiền thừa. Nếu khách
            không yêu cầu thừa tiền (làm tròn, tip) → bấm <b>Tip</b>.
          </li>
          <li>
            Bấm <b>Hoàn tất</b> → in bill → giao bill + tiền thừa cho khách. Khách
            đi xong mới cho phép thanh toán đơn tiếp theo.
          </li>
        </ol>
      </section>

      <section className="warn">
        <h2>3. Xử lý sự cố</h2>
        <h3>Khách đòi đổi món sau khi đã thanh toán</h3>
        <ol>
          <li>
            Nếu món chưa làm — báo bếp huỷ ngay. Mở <b>Lịch sử đơn F&B</b> → tìm bill
            → bấm <b>Huỷ</b>. Bạn không có quyền huỷ trực tiếp → hệ thống sẽ yêu cầu{" "}
            <b>mã OTP từ quản lý</b>. Gọi quản lý qua điện thoại / Zalo lấy mã 6 số.
          </li>
          <li>
            Nhập mã OTP + lý do huỷ rõ ràng (VD &quot;Khách đổi món sang trà chanh&quot;).
          </li>
          <li>
            Sau khi huỷ thành công — hệ thống tự tạo phiếu chi hoàn tiền + trả kho.
            Bạn chỉ cần thực tế trả tiền mặt cho khách.
          </li>
        </ol>

        <h3>Nhập sai số tiền — Tip / tiền thừa sai</h3>
        <p>
          <b>Tuyệt đối không tự sửa</b>. Gọi quản lý duyệt OTP để hủy bill cũ + tạo
          bill mới. Ghi rõ lý do trong dialog huỷ — đây là chứng cứ trong audit log
          khi đối chiếu cuối ngày.
        </p>

        <h3>Mất mạng đột ngột</h3>
        <ol>
          <li>
            Hệ thống tự chuyển sang chế độ ngoại tuyến — vẫn bán được đơn tiền mặt.
            Đơn chuyển khoản tạm dừng — báo khách đợi mạng hoặc trả tiền mặt.
          </li>
          <li>
            Khi mạng có lại — đơn sẽ tự đồng bộ. Kiểm tra biểu tượng đồng bộ ở góc
            phải trên có dấu xanh không.
          </li>
        </ol>

        <h3>Khách yêu cầu giảm giá ngoài chương trình</h3>
        <p>
          Đưa giảm giá theo % hoặc số tiền cố định ở cart. Khi nhập giá trị,{" "}
          <b>hệ thống yêu cầu OTP từ quản lý duyệt</b>. Mọi giảm giá thủ công đều
          ghi vào audit log với danh tính người duyệt + lý do — không được lách qua.
        </p>
      </section>

      <section>
        <h2>4. Cuối ca — Đóng ca</h2>
        <ol>
          <li>
            Đếm tiền mặt thực tế trong két (không tính tiền lẻ đầu ca đã ghi). Đếm
            kỹ 2 lần.
          </li>
          <li>
            Bấm nút <b>Đóng ca</b> trên màn hình POS. Nhập số tiền mặt thực tế. Hệ
            thống so với số kỳ vọng (tiền mặt đầu ca + thu mặt − chi mặt).
          </li>
          <li>
            Nếu sai &gt; 5.000đ — báo quản lý <b>ngay</b>. Ghi rõ lý do trong ô{" "}
            <b>Ghi chú đóng ca</b> (VD &quot;Quên ghi tiền thừa 10k cho khách&quot;,
            &quot;Có thể nhập sai 1 đơn&quot;).
          </li>
          <li>
            In biên bản đóng ca → ký xác nhận → giao tiền cho quản lý theo quy định
            của quán.
          </li>
          <li>
            Đăng xuất khỏi máy POS. Không để tài khoản đăng nhập qua đêm.
          </li>
        </ol>
      </section>

      <section className="tip">
        <h2>5. Quy tắc nội bộ</h2>
        <ul>
          <li>
            <b>PIN cá nhân</b>: Không cho ai biết, kể cả đồng nghiệp. Mất PIN → vào{" "}
            <b>Tài khoản → Đổi PIN</b> để đặt lại. Quản lý không biết PIN của bạn.
          </li>
          <li>
            <b>Không in lại bill cho khách quay lại sau ca</b> — bạn không xác thực
            được khách thật/giả. Hướng dẫn khách liên hệ quản lý nếu cần hoá đơn.
          </li>
          <li>
            <b>Không nhận thanh toán qua tài khoản cá nhân</b>. Mọi chuyển khoản phải
            qua mã QR VietQR của quán.
          </li>
          <li>
            <b>Tip</b> chia đều cuối ca theo quy định quán — không giữ riêng.
          </li>
          <li>
            <b>Không huỷ bill thay người khác</b> — luôn dùng tài khoản chính bạn,
            kể cả khi đồng nghiệp nhờ.
          </li>
        </ul>
      </section>

      <div className="footer">
        Mọi thắc mắc, đề nghị liên hệ quản lý ca trực hoặc nhắn nhóm Zalo nội bộ
        &quot;OneBiz — Vận hành&quot;. Tài liệu sẽ cập nhật khi có thay đổi —
        kiểm tra bản mới nhất tại <code>onebiz.com.vn/sop/thu-ngan</code>.
      </div>
    </div>
  );
}
