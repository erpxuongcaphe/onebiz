// Day 5 16/05/2026: SOP cho Pha chế (Barista) — thuần Vietnamese.

export default function SopBaristaPage() {
  return (
    <div>
      <header className="header">
        <div>
          <h1>Quy trình tác nghiệp — Pha chế</h1>
          <p className="role">Áp dụng tại 3 quán Cà Phê OneBiz • Ban hành 16/05/2026</p>
        </div>
        <div className="role">
          <b>OneBiz</b> · Tài liệu nội bộ
        </div>
      </header>

      <p>
        Vai trò của bạn là người tạo ra chất lượng đồ uống cuối cùng đến khách. Bạn
        chịu trách nhiệm về độ đồng đều, vệ sinh, và quản lý nguyên liệu trong ca.
      </p>

      <section>
        <h2>1. Trước ca — Chuẩn bị</h2>
        <ol>
          <li>
            Đến quán trước giờ mở cửa <b>30 phút</b>. Vệ sinh tay theo 6 bước (ướt,
            xà phòng, chà 20 giây, rửa, lau khô, sát khuẩn).
          </li>
          <li>
            Kiểm tra máy pha cà phê — vệ sinh đầu nhóm bằng bàn chải nylon (không
            dùng cọ kim loại). Chạy 1 ly espresso trắng để bốc bụi.
          </li>
          <li>
            Mở các tủ nguyên liệu — kiểm tra hạn dùng theo nguyên tắc{" "}
            <b>&quot;Nhập trước, xuất trước&quot; (FIFO)</b>. Đặt nguyên liệu gần hết
            hạn ra ngoài cùng.
          </li>
          <li>
            Đong sẵn syrup, sữa đặc trong các bình bấm — đỡ thao tác trong giờ cao
            điểm. Ghi tên + ngày đong trên bình.
          </li>
          <li>
            Mở màn hình KDS (Kitchen Display System) trên iPad/máy bếp. Đăng nhập
            tài khoản pha chế của bạn.
          </li>
        </ol>
      </section>

      <section>
        <h2>2. Trong ca — Pha chế theo phiếu</h2>
        <h3>Quy trình tiếp nhận đơn</h3>
        <ol>
          <li>
            Khi có đơn mới — màn hình KDS sẽ nhấp nháy + báo âm thanh ngắn. Phiếu
            mới luôn xuất hiện bên trái màn hình.
          </li>
          <li>
            Đọc đơn kỹ — chú ý <b>biến thể</b> (size lớn / nhỏ, đá nhiều / ít,
            không đường) + <b>topping</b> + <b>ghi chú</b> (VD &quot;Không bột&quot;,
            &quot;Pha loãng&quot;).
          </li>
          <li>
            Bấm <b>Bắt đầu pha</b> trên phiếu → phiếu chuyển sang trạng thái{" "}
            <i>Đang pha</i>. Khách + thu ngân thấy được bạn đã nhận đơn.
          </li>
          <li>
            Pha theo công thức chuẩn của quán (xem file công thức gốc ở quầy hoặc
            ấn nút <b>Xem công thức</b> trên KDS).
          </li>
          <li>
            Khi hoàn thành — bấm <b>Hoàn tất</b>. Phiếu chuyển sang cột{" "}
            <i>Đã xong</i>. Thu ngân/runner gọi khách đến lấy.
          </li>
        </ol>

        <h3>Trong giờ cao điểm (peak hour)</h3>
        <ul>
          <li>Pha song song nhiều đơn cùng lúc — gom các đơn cùng loại.</li>
          <li>
            Ưu tiên đơn ở quán (dine-in) trước đơn mang về vì khách đang chờ tại
            chỗ.
          </li>
          <li>
            Ưu tiên đơn có tag <b>VIP</b> hoặc <b>Đơn ưu tiên</b> — quản lý đã đánh
            dấu trên POS.
          </li>
          <li>
            Nếu đơn quá nhiều — báo quản lý ca để chia tải hoặc tạm tắt nhận đơn
            online.
          </li>
        </ul>
      </section>

      <section className="warn">
        <h2>3. Xử lý sự cố</h2>
        <h3>Hết nguyên liệu giữa ca</h3>
        <ol>
          <li>
            Báo ngay quản lý ca — không tự ý thay thế nguyên liệu khác (VD hết sữa
            tươi → KHÔNG tự dùng sữa đặc thay).
          </li>
          <li>
            Vào <b>POS → Cài đặt → Sản phẩm</b> hoặc nhờ quản lý tắt món hết NVL khỏi
            menu để thu ngân không bán thêm.
          </li>
          <li>
            Phiếu KDS đã nhận nhưng chưa pha — báo thu ngân huỷ + xin lỗi khách +
            mời chọn món khác.
          </li>
        </ol>

        <h3>Khách phản hồi đồ uống không đúng vị</h3>
        <ol>
          <li>
            Lắng nghe khách — không tranh cãi. Hỏi cụ thể (VD &quot;Quá ngọt&quot;,
            &quot;Bị nhạt cà phê&quot;).
          </li>
          <li>Đề nghị pha lại miễn phí ngay tại chỗ.</li>
          <li>
            Báo quản lý ca để xử lý ghi chú audit (đặc biệt nếu là trường hợp lặp
            lại — có thể máy pha lỗi).
          </li>
        </ol>

        <h3>Máy pha cà phê lỗi</h3>
        <ol>
          <li>
            Tắt máy ngay nếu thấy khói / cháy / chập điện. Ngắt cầu dao tủ điện
            quầy.
          </li>
          <li>
            Báo quản lý → quản lý liên hệ kỹ thuật theo số đường dây nóng được dán
            bên hông máy.
          </li>
          <li>
            Trong khi đợi sửa — chuyển sang pha drip / latte máy phụ. Nếu không có
            máy phụ → tạm tắt menu cà phê trên POS.
          </li>
        </ol>
      </section>

      <section>
        <h2>4. Cuối ca — Đóng quầy pha chế</h2>
        <ol>
          <li>
            Vệ sinh máy pha — chạy chương trình rửa back-flush nếu máy hỗ trợ. Lau
            sạch khay tràn, đầu nhóm.
          </li>
          <li>
            Lau quầy, đổ rác chai lọ syrup hết, rửa bình lắc, ly mẫu.
          </li>
          <li>
            Đậy nắp các bình syrup / sữa đặc → ghi nhãn ngày → cất tủ lạnh.
          </li>
          <li>
            Kiểm tra tồn nguyên liệu cuối ca → cập nhật vào{" "}
            <b>Phiếu xuất dùng nội bộ</b> trên hệ thống nếu có dùng cho mẫu thử,
            hỏng. Báo quản lý để khớp kho.
          </li>
          <li>
            Đăng xuất KDS. Tắt máy pha nếu là người cuối ca.
          </li>
        </ol>
      </section>

      <section className="tip">
        <h2>5. Quy tắc nội bộ</h2>
        <ul>
          <li>
            <b>Không nhận tip riêng</b> — mọi tip khách đưa tận tay quầy đều bỏ vào
            hộp tip chung, chia cuối ca.
          </li>
          <li>
            <b>Không tự thay đổi công thức</b> — công thức là tài sản quán, đảm bảo
            đồng đều giữa các chi nhánh.
          </li>
          <li>
            <b>Không uống thử nguyên liệu thô</b> (sữa, syrup) bằng cách bốc từ bình
            chung — dùng ly riêng đong sạch.
          </li>
          <li>
            <b>Không vừa pha vừa dùng điện thoại</b> — đặt điện thoại ra xa khu pha
            chế. Liên lạc cá nhân giải quyết giờ giải lao.
          </li>
          <li>
            <b>Báo ngay khi bị thương / bệnh</b> — ngừng phục vụ, báo quản lý thay
            ca. Không tiếp tục pha chế khi đang ho, sổ mũi.
          </li>
        </ul>
      </section>

      <div className="footer">
        Mọi thắc mắc, đề nghị liên hệ quản lý ca trực hoặc nhắn nhóm Zalo nội bộ
        &quot;OneBiz — Pha chế&quot;. Tài liệu sẽ cập nhật khi có công thức mới —
        kiểm tra bản mới nhất tại <code>onebiz.com.vn/sop/pha-che</code>.
      </div>
    </div>
  );
}
