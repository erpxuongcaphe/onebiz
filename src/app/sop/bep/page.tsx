// Day 5 16/05/2026: SOP cho Bếp (Kitchen) — thuần Vietnamese.

export default function SopKitchenPage() {
  return (
    <div>
      <header className="header">
        <div>
          <h1>Quy trình tác nghiệp — Bếp</h1>
          <p className="role">Áp dụng tại 3 quán Cà Phê OneBiz • Ban hành 16/05/2026</p>
        </div>
        <div className="role">
          <b>OneBiz</b> · Tài liệu nội bộ
        </div>
      </header>

      <p>
        Vai trò của bạn là người chế biến đồ ăn (bánh, ăn nhẹ, ăn sáng) theo phiếu
        bếp gửi từ POS. Bạn chịu trách nhiệm về vệ sinh an toàn thực phẩm, kiểm soát
        nguyên liệu, và thời gian ra món.
      </p>

      <section>
        <h2>1. Trước ca — Mở bếp</h2>
        <ol>
          <li>
            Đến quán trước giờ mở cửa <b>45 phút</b>. Mặc đồng phục, đeo tạp dề, đội
            mũ trùm tóc.
          </li>
          <li>
            Vệ sinh tay theo 6 bước. Sát khuẩn dao, thớt, mặt bàn bằng dung dịch
            chuyên dụng.
          </li>
          <li>
            Mở tủ lạnh / tủ đông kiểm tra nguyên liệu — nguyên tắc{" "}
            <b>&quot;Nhập trước, xuất trước&quot; (FIFO)</b>. Loại nguyên liệu nào
            sắp hết hạn, đặt phía trước để dùng sớm.
          </li>
          <li>
            Kiểm tra hạn dùng các nguyên liệu chế biến sẵn (bánh ngọt, sốt, kem...).
            Bỏ ngay nếu quá hạn — chụp ảnh báo quản lý để ghi xuất hủy đúng.
          </li>
          <li>
            Bật bếp, lò nướng, máy ép — kiểm tra hoạt động bình thường.
          </li>
          <li>
            Mở màn hình KDS bếp trên iPad/máy bếp. Đăng nhập tài khoản bếp của bạn.
          </li>
        </ol>
      </section>

      <section>
        <h2>2. Trong ca — Chuẩn bị món</h2>
        <h3>Quy trình tiếp nhận phiếu</h3>
        <ol>
          <li>
            Đơn mới xuất hiện trên KDS — đọc kỹ <b>tên món</b>, <b>biến thể</b>,
            <b>topping</b>, <b>ghi chú</b> đặc biệt (VD &quot;Không hành&quot;,
            &quot;Chín kỹ&quot;, &quot;Đóng gói riêng&quot;).
          </li>
          <li>
            Bấm <b>Bắt đầu làm</b> → phiếu chuyển sang <i>Đang chế biến</i> — thu
            ngân thấy được thời gian bạn nhận đơn.
          </li>
          <li>
            Chế biến đúng công thức quán. Đặt món sạch lên đĩa/khay riêng cho từng
            đơn — KHÔNG trộn các đơn vào nhau.
          </li>
          <li>
            Khi hoàn thành — bấm <b>Hoàn tất</b> → đặt món ra quầy giao hoặc gọi
            phục vụ mang đến bàn.
          </li>
        </ol>

        <h3>Trong giờ cao điểm</h3>
        <ul>
          <li>
            Ưu tiên các món chế biến nhanh trước (toast, sandwich nguội) — đảm bảo
            khách không đợi quá 15 phút.
          </li>
          <li>
            Món nướng / chiên lâu (bánh pizza, ức gà nướng) — bắt đầu ngay khi thấy
            đơn, không đợi đơn khác.
          </li>
          <li>
            Đơn có tag <b>VIP</b> / <b>Đơn ưu tiên</b> — ra trước, kể cả đơn đến sau.
          </li>
          <li>
            Nếu món hỏng (cháy, đổ) — báo quản lý ca + làm lại miễn phí ngay. Ghi
            nhận vào{" "}
            <b>Phiếu xuất hủy</b> để khớp kho cuối ngày.
          </li>
        </ul>
      </section>

      <section className="warn">
        <h2>3. Xử lý sự cố</h2>
        <h3>Hết nguyên liệu giữa ca</h3>
        <ol>
          <li>
            Báo ngay quản lý — đề nghị tắt món khỏi POS (Cài đặt → Sản phẩm → ngừng
            bán).
          </li>
          <li>
            Đơn đã nhận nhưng chưa làm — báo thu ngân huỷ + xin lỗi khách + mời
            đổi món.
          </li>
          <li>
            Cập nhật bảng &quot;Hết hàng&quot; đặt ở quầy thu ngân để khách biết.
          </li>
        </ol>

        <h3>Khách báo món sai / không đúng</h3>
        <ol>
          <li>
            Lắng nghe khách — không tranh cãi. Hỏi cụ thể (VD &quot;Em đặt không
            hành mà có hành&quot;).
          </li>
          <li>
            Đề nghị làm lại miễn phí ngay. Kiểm tra lại ghi chú trên phiếu KDS —
            nếu có ghi rõ → là lỗi bếp, ghi nhận để cải thiện.
          </li>
          <li>
            Báo quản lý ca để cập nhật audit log + báo huỷ phần đã làm sai vào
            phiếu xuất hủy.
          </li>
        </ol>

        <h3>Sự cố vệ sinh / an toàn thực phẩm</h3>
        <ul>
          <li>
            Phát hiện nguyên liệu có dấu hiệu hỏng (mùi lạ, đổi màu) — BỎ NGAY,
            không dùng. Chụp ảnh báo quản lý + ghi vào phiếu xuất hủy.
          </li>
          <li>
            Đứt tay / phỏng — dừng việc, sơ cứu, đeo găng tay nilon dùng 1 lần
            trước khi tiếp tục. Báo quản lý nếu vết thương lớn.
          </li>
          <li>
            Đang ho / sốt — không tiếp tục chế biến. Báo quản lý đổi ca.
          </li>
          <li>
            Sự cố tủ lạnh / tủ đông mất điện &gt; 4 giờ — báo quản lý ngay để
            quyết định bỏ nguyên liệu (đảm bảo an toàn).
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Cuối ca — Đóng bếp</h2>
        <ol>
          <li>
            Tắt bếp, lò nướng, máy ép. Ngắt nguồn điện các thiết bị không cần thiết.
          </li>
          <li>
            Vệ sinh bếp — lau mặt bếp, mặt bàn, dao thớt. Đổ rác.
          </li>
          <li>
            Đậy kín nguyên liệu, sốt, kem — cất tủ lạnh đúng nhiệt độ.
          </li>
          <li>
            Kiểm kê nhanh các nguyên liệu sắp hết — báo quản lý đặt hàng nhập.
          </li>
          <li>
            Tổng kết các phiếu xuất hủy / hỏng trong ca → quản lý xác nhận.
          </li>
          <li>
            Đăng xuất KDS bếp.
          </li>
        </ol>
      </section>

      <section className="tip">
        <h2>5. Quy tắc nội bộ</h2>
        <ul>
          <li>
            <b>Vệ sinh trước — vệ sinh trong — vệ sinh sau</b>. Mỗi 1 giờ rửa lại
            tay + sát khuẩn dao thớt.
          </li>
          <li>
            <b>Không ăn uống tại khu chế biến</b>. Khu nghỉ riêng cho nhân viên.
          </li>
          <li>
            <b>Không dùng điện thoại tại khu chế biến</b>. Lưu trong tủ cá nhân.
          </li>
          <li>
            <b>Không tự sáng tạo món</b> — chỉ làm món đã có trong menu. Đề xuất món
            mới qua quản lý ca, không tự thử món cho khách.
          </li>
          <li>
            <b>Kiểm tra hạn dùng mỗi lần lấy nguyên liệu</b> — không tin tủ lạnh,
            xem nhãn ngày trên bao bì.
          </li>
        </ul>
      </section>

      <div className="footer">
        Mọi thắc mắc, đề nghị liên hệ quản lý ca trực hoặc nhắn nhóm Zalo nội bộ
        &quot;OneBiz — Bếp&quot;. Tài liệu sẽ cập nhật khi có món mới —
        kiểm tra bản mới nhất tại <code>onebiz.com.vn/sop/bep</code>.
      </div>
    </div>
  );
}
