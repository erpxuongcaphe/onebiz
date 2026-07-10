# Hướng dẫn cài đặt quán FnB trên OneBiz
**Từ A đến Z — dành cho người setup menu (chủ quán / quản lý / nhân viên)**

Chào bạn! Tài liệu này sẽ đi cùng bạn từ đầu đến cuối: từ lúc tạo món, khai công thức pha chế theo từng cỡ ly, cho tới khi bán thử trên máy tính tiền. Bạn cứ đọc thong thả, làm tới đâu chắc tới đó. Mọi thứ đều làm trên web, không cần biết kỹ thuật gì cả.

> Tài liệu này thay cho các bản hướng dẫn FnB rời rạc trước đây, và đã được cập nhật đúng theo phần mềm hiện tại.

---

## Phần mở đầu — Hiểu nhanh cách hệ thống làm việc

Trước khi bắt tay, bạn hãy hình dung bức tranh chung. Một quán cà phê hoạt động thế này: trong kho có sẵn các **nguyên liệu** (cà phê, sữa, đường, ly, ống hút…). Khi khách gọi một **món**, mình lấy nguyên liệu ra pha theo một **công thức**. Khách lại còn dặn thêm dăm điều — ít đường, nhiều đá, thêm trân châu — đó là các **tùy chọn**.

Phần mềm cũng hiểu y như vậy. Để nó phục vụ mình tốt, mình cần khai cho nó biết bốn điều:

<svg viewBox="0 0 660 250" width="660" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">
  <rect width="660" height="250" fill="#ffffff"/>
  <rect x="30" y="60" width="150" height="120" rx="14" fill="#fff7ed" stroke="#fcd9a8" stroke-width="1.5"/>
  <text x="105" y="92" text-anchor="middle" font-size="15" font-weight="bold" fill="#9a5a12">Nguyên liệu</text>
  <text x="105" y="118" text-anchor="middle" font-size="12" fill="#6b7280">Cà phê, sữa,</text>
  <text x="105" y="136" text-anchor="middle" font-size="12" fill="#6b7280">đường, ly…</text>
  <text x="105" y="158" text-anchor="middle" font-size="11" fill="#9aa7b8">(đã có trong kho)</text>
  <rect x="255" y="40" width="170" height="160" rx="14" fill="#f1f7ff" stroke="#bcd7f5" stroke-width="1.5"/>
  <text x="340" y="70" text-anchor="middle" font-size="15" font-weight="bold" fill="#1e3a5f">Món</text>
  <text x="340" y="96" text-anchor="middle" font-size="12" fill="#374151">• Thuộc một nhóm</text>
  <text x="340" y="118" text-anchor="middle" font-size="12" fill="#374151">• Có công thức</text>
  <text x="340" y="140" text-anchor="middle" font-size="12" fill="#374151">  riêng theo cỡ</text>
  <text x="340" y="162" text-anchor="middle" font-size="12" fill="#374151">• Có các tùy chọn</text>
  <rect x="495" y="60" width="150" height="120" rx="14" fill="#eafaf1" stroke="#a8e0c2" stroke-width="1.5"/>
  <text x="570" y="100" text-anchor="middle" font-size="15" font-weight="bold" fill="#136f43">Bán hàng</text>
  <text x="570" y="128" text-anchor="middle" font-size="12" fill="#374151">Tự trừ kho</text>
  <text x="570" y="146" text-anchor="middle" font-size="12" fill="#374151">đúng nguyên liệu</text>
  <line x1="185" y1="120" x2="248" y2="120" stroke="#9aa7b8" stroke-width="2" marker-end="url(#mh)"/>
  <line x1="430" y1="120" x2="488" y2="120" stroke="#9aa7b8" stroke-width="2" marker-end="url(#mh)"/>
  <defs><marker id="mh" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#9aa7b8"/></marker></defs>
  <text x="330" y="232" text-anchor="middle" font-size="12" fill="#6b7280">Khai báo một lần — về sau mỗi lần bán, phần mềm tự lo phần trừ kho.</text>
</svg>

Có **bốn khái niệm** bạn cần phân biệt rõ, vì hay nhầm:

1. **Nhóm món** — để gom các món cùng loại lại (Cà phê, Trà sữa, Sinh tố…), giúp máy tính tiền hiển thị gọn gàng.
2. **Cỡ ly (quy cách)** — như cỡ M, cỡ L. Mỗi cỡ có **giá riêng** và **công thức riêng**.
3. **Công thức pha chế** — mỗi cỡ cần bao nhiêu nguyên liệu. Bán cỡ nào thì trừ kho đúng cỡ đó.
4. **Tùy chọn** — những điều khách dặn thêm: mức đường, mức đá, topping.

> **Một điều giúp bạn đỡ vất vả:** nguyên liệu thì quán mình **đã có sẵn trong kho** rồi (cà phê, sữa, ly…). Khi khai công thức, mình chỉ việc chọn lại, **không phải tạo mới nguyên liệu**.

---

## Phần 1 — Kiểm tra nguyên liệu trong kho

Việc đầu tiên, bạn hãy chắc chắn rằng các nguyên liệu để pha món đã có trong kho: cà phê, sữa, đường, syrup, trân châu, ly, ống hút…

Bạn vào mục **Hàng hóa**, chọn thẻ **Nguyên vật liệu** và xem qua. Nếu thiếu thứ gì, hãy thêm vào trước (phần này giống như nhập hàng bình thường). Khi nguyên liệu đã đủ, mình mới bắt tay vào tạo món được — vì công thức sẽ trỏ tới chính các nguyên liệu này.

---

## Phần 2 — Tạo nhóm món

Mỗi món phải nằm trong một nhóm, ví dụ "Cà phê", "Trà sữa", "Sinh tố". Nhóm giúp máy tính tiền chia tab cho dễ bấm, và giúp mình xem báo cáo doanh thu theo từng loại.

Bạn vào **Danh mục → Nhóm hàng**, chuyển sang thẻ **Hàng bán**, rồi bấm **Tạo mới**. Khi tạo nhóm, nhớ chọn **Kênh bán là FnB** — đây là điều quan trọng, vì chỉ những món thuộc kênh FnB mới hiện ra trên máy tính tiền của quán.

Bạn cứ tạo đủ các nhóm mà menu quán mình có. Vài nhóm thường gặp: Cà phê pha máy, Cà phê truyền thống, Trà, Trà sữa, Sinh tố, Đá xay, Nước ép.

> Mẹo: nếu menu nhiều, bạn có thể dùng nút **Nhập Excel** để tạo hàng loạt nhóm một lần cho nhanh.

---

## Phần 3 — Tạo các tùy chọn (mức đường, mức đá, topping)

"Tùy chọn" là những điều khách hay dặn thêm khi gọi món. Phần mềm đã chuẩn bị sẵn một bộ tùy chọn mẫu theo thói quen quán Việt, bạn chỉ cần bấm một nút là có.

Bạn vào **Danh mục → Tuỳ chọn món FnB**, rồi bấm nút **Tạo bộ tuỳ chọn mẫu** ở góc trên. Chỉ sau một giây, hệ thống tạo cho bạn ba nhóm tùy chọn:

| Tùy chọn | Các lựa chọn | Có trừ kho không? |
|----------|--------------|-------------------|
| **Mức đường** | 0% · 30% · 50% · 70% · 100% | Có — phần mềm trừ lượng đường theo đúng phần trăm khách chọn |
| **Mức đá** | Không đá · Ít · Vừa · Nhiều | Không — chỉ là lời nhắc để pha cho đúng |
| **Topping** | (để trống, bạn tự thêm) | Có — mỗi topping trừ nguyên liệu riêng của nó |

Bạn để ý ba điều quan trọng ở đây:

- **Mức đường** thì có trừ kho: khách chọn 70% thì phần mềm chỉ trừ 70% lượng đường so với công thức gốc. Rất tiện và chính xác.
- **Mức đá** chỉ là **lời nhắc cho người pha**, không trừ kho. Đá không tính vào nguyên liệu.
- **Topping** (trân châu, thạch…) thì mỗi loại có nguyên liệu riêng, bán kèm sẽ trừ riêng. Bạn tự thêm các topping của quán vào.

> **Lưu ý đáng nhớ:** cỡ ly (M, L) **không nằm ở đây**. Hồi trước hệ thống từng để cỡ ly chung với tùy chọn, nhưng giờ đã tách ra: **cỡ ly là "quy cách" của món**, khai ngay trong từng món (xem Phần 4). Nhờ vậy mỗi cỡ mới có công thức riêng được.

Bộ tùy chọn này chỉ cần tạo **một lần** cho cả quán. Sau đó bạn gán nó cho các nhóm món: vào **Danh mục → Nhóm hàng**, mở từng nhóm rồi tích các tùy chọn phù hợp. Khi đã gán cho nhóm, mọi món trong nhóm đó **tự thừa kế**, bạn không phải gán lại từng món.

---

## Phần 4 — Tạo món, khai cỡ ly và công thức theo cỡ

Đây là phần chính và quan trọng nhất. Bạn hãy hình dung quán mình bán món cà phê sữa, có hai cỡ: **cỡ vừa (M)** và **cỡ lớn (L)**. Hai cỡ này không chỉ khác cái ly, mà còn khác cả lượng nguyên liệu bên trong — ly lớn nhiều cà phê hơn, nhiều sữa hơn.

<svg viewBox="0 0 640 300" width="640" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">
  <rect x="0" y="0" width="640" height="300" fill="#ffffff"/>
  <text x="320" y="32" text-anchor="middle" font-size="18" font-weight="bold" fill="#1e3a5f">Cùng một món, mỗi cỡ một công thức riêng</text>
  <rect x="40" y="58" width="255" height="200" rx="14" fill="#f1f7ff" stroke="#bcd7f5" stroke-width="1.5"/>
  <path d="M 108 92 L 182 92 L 174 150 L 116 150 Z" fill="#cfa07a" stroke="#8a5a3b" stroke-width="2"/>
  <path d="M 116 150 L 174 150 L 171 168 L 119 168 Z" fill="#8a5a3b"/>
  <text x="167" y="192" text-anchor="middle" font-size="15" font-weight="bold" fill="#1e3a5f">Cỡ M (vừa)</text>
  <text x="64" y="216" font-size="13" fill="#374151">• Cà phê: 18 g</text>
  <text x="64" y="236" font-size="13" fill="#374151">• Sữa: 80 ml</text>
  <text x="64" y="256" font-size="13" fill="#374151">• Ly nhỏ: 1 cái</text>
  <rect x="345" y="58" width="255" height="200" rx="14" fill="#eafaf1" stroke="#a8e0c2" stroke-width="1.5"/>
  <path d="M 405 84 L 495 84 L 485 152 L 415 152 Z" fill="#cfa07a" stroke="#8a5a3b" stroke-width="2"/>
  <path d="M 415 152 L 485 152 L 482 172 L 418 172 Z" fill="#8a5a3b"/>
  <text x="472" y="196" text-anchor="middle" font-size="15" font-weight="bold" fill="#136f43">Cỡ L (lớn)</text>
  <text x="369" y="216" font-size="13" fill="#374151">• Cà phê: 25 g</text>
  <text x="369" y="236" font-size="13" fill="#374151">• Sữa: 120 ml</text>
  <text x="369" y="256" font-size="13" fill="#374151">• Ly lớn: 1 cái</text>
  <text x="320" y="288" text-anchor="middle" font-size="13" fill="#6b7280">Bán cỡ nào, phần mềm tự trừ kho đúng cỡ đó.</text>
</svg>

Vì thế, mỗi cỡ ly mình ghi một công thức riêng. Toàn bộ việc này gói gọn trong năm bước, và điều dễ chịu nhất là **chỉ bấm Lưu một lần duy nhất** ở cuối:

<svg viewBox="0 0 680 150" width="680" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">
  <defs><marker id="ar" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#9aa7b8"/></marker></defs>
  <rect width="680" height="150" fill="#ffffff"/>
  <line x1="86" y1="48" x2="172" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="222" y1="48" x2="308" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="358" y1="48" x2="444" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="494" y1="48" x2="580" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <circle cx="60" cy="48" r="26" fill="#2563eb"/><text x="60" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">1</text>
  <circle cx="197" cy="48" r="26" fill="#2563eb"/><text x="197" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">2</text>
  <circle cx="334" cy="48" r="26" fill="#2563eb"/><text x="334" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">3</text>
  <circle cx="471" cy="48" r="26" fill="#2563eb"/><text x="471" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">4</text>
  <circle cx="608" cy="48" r="26" fill="#16a34a"/><text x="608" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">5</text>
  <text x="60" y="100" text-anchor="middle" font-size="13" fill="#374151">Tạo món</text>
  <text x="197" y="100" text-anchor="middle" font-size="13" fill="#374151">Thêm các cỡ</text>
  <text x="334" y="100" text-anchor="middle" font-size="13" fill="#374151">Bật công thức</text>
  <text x="471" y="100" text-anchor="middle" font-size="13" fill="#374151">Điền bảng</text>
  <text x="608" y="100" text-anchor="middle" font-size="13" font-weight="bold" fill="#16803d">Bấm Lưu</text>
  <text x="608" y="120" text-anchor="middle" font-size="11" fill="#6b7280">(một lần)</text>
</svg>

### Bước 1 — Tạo món
Bạn vào **Hàng hóa**, bấm **Tạo mới**, rồi chuyển sang loại **Hàng bán**. Điền tên món, chọn **nhóm món** (đã tạo ở Phần 2), và chọn **kênh bán là FnB**. Phần giá vốn cứ để trống — lát nữa phần mềm sẽ tự tính từ công thức. Bấm lưu để món có mặt trong hệ thống.

### Bước 2 — Khai báo các cỡ ly
Mở món vừa tạo lên, bấm sang thẻ **Quy cách**, rồi bấm **Thêm quy cách** cho mỗi cỡ:
- Ô **Tên**: gõ tên cỡ, ví dụ M, L.
- Ô **Giá bán**: gõ giá của cỡ đó (phần mềm tự thêm dấu chấm hàng nghìn cho dễ nhìn).
Cỡ nào hay bán nhất thì đánh dấu **Mặc định**.

### Bước 3 — Bật phần công thức
Ngay dưới danh sách cỡ ly, có một ô tích nhỏ: **"Trừ kho theo công thức từng size"**. Bạn tích vào đó, lập tức một cái bảng hiện ra để điền công thức.

### Bước 4 — Điền công thức cho từng cỡ
Bảng có một cột ghi tên nguyên liệu, một cột đơn vị, và **mỗi cỡ ly một cột riêng**. Với mỗi nguyên liệu, bạn làm ba việc nhỏ:

1. Ở cột **Nguyên liệu**, gõ vài chữ để tìm rồi chọn (ví dụ gõ "sữa" là nó lọc ra cho bạn chọn nhanh).
2. Phần mềm **tự điền sẵn đơn vị** của nguyên liệu đó.
3. Ở cột của từng cỡ, gõ **lượng cần dùng**. Lượng được phép có số lẻ, ví dụ 0,5.

Có hai điều nên gắn cho khéo:
- Với **đường hoặc syrup**, ở cột "Theo modifier" bạn chọn **Mức đường**. Như vậy khi khách chọn 70%, phần mềm tự trừ 70% lượng đường. Còn cà phê, sữa, cái ly thì để **Cố định**.
- Một mẹo nhanh: nếu các cỡ chỉ khác nhau chút ít, bạn điền cho cỡ đầu trước rồi bấm **"Gợi ý: copy cỡ M sang cỡ khác"**, sau đó chỉnh lại vài chỗ.

Điền xong, ở cuối bảng phần mềm còn **tự tính giá vốn cho từng cỡ** giúp bạn — rất tiện để biết mỗi ly tốn bao nhiêu tiền nguyên liệu.

### Bước 5 — Bấm Lưu một lần
Cuối cùng bấm nút **Lưu** ở góc dưới. Chỉ một lần bấm này thôi là **cả các cỡ ly lẫn công thức đều được lưu cùng lúc**.

> **Một ví dụ cho dễ hình dung** — món "Cà phê sữa" hai cỡ:

| Nguyên liệu | Cỡ M | Cỡ L |
|-------------|:----:|:----:|
| Cà phê | 18 g | 25 g |
| Sữa tươi | 80 ml | 120 ml |
| Ly nhỏ | 1 cái | — |
| Ly lớn | — | 1 cái |

Đọc bảng: bán một ly cỡ M thì trừ 18 g cà phê, 80 ml sữa và một ly nhỏ; còn ly cỡ L thì trừ 25 g cà phê, 120 ml sữa và một ly lớn. Bạn để ý dòng cái ly: cỡ M dùng ly nhỏ, cỡ L dùng ly lớn — đó chính là lý do mỗi cỡ phải có công thức riêng.

---

## Phần 5 — Món chỉ có một cỡ

Không phải món nào cũng nhiều cỡ. Với những món chỉ bán một cỡ duy nhất (ví dụ một loại bánh), bạn không cần khai quy cách. Bạn chỉ cần vào thẻ **Công thức** của món, thêm các nguyên liệu và lượng dùng, rồi lưu lại. Cách làm tương tự bảng công thức ở trên, chỉ là không chia theo cỡ.

---

## Phần 6 — Bán thử để kiểm tra

Sau khi khai xong, bạn nên bán thử một ly để chắc chắn mọi thứ chạy đúng.

Mở **máy tính tiền của quán** (POS FnB), chọn món vừa tạo. Một bảng hiện ra cho bạn:
- Chọn **cỡ ly** — giá tự đổi theo cỡ.
- Chọn **mức đường, mức đá**, thêm topping nếu khách muốn.

Bấm thêm vào đơn rồi thanh toán. Xong, bạn quay lại mục **Hàng hóa → Nguyên vật liệu**, tìm nguyên liệu vừa dùng (ví dụ sữa) và xem tồn kho — nó phải **giảm đúng bằng lượng trong công thức của cỡ bạn vừa bán**. Nếu đúng như vậy là bạn đã thành công.

---

## Phần 7 — Những câu hỏi hay gặp

**Tôi bán một ly mà kho không trừ?**
Thường là vì món chưa có công thức, hoặc bạn quên bật ô "Trừ kho theo công thức từng size". Bạn mở món lên, kiểm tra lại thẻ Quy cách.

**Món tôi vừa tạo không thấy trên máy tính tiền?**
Hãy kiểm tra kênh bán của món có phải là FnB không, và món có đang ở trạng thái đang bán không. Nếu vẫn chưa thấy, thử tải lại trang máy tính tiền.

**Đá thì khai ở đâu?**
Đá không khai vào công thức, vì đá không tính vào kho. Đá chỉ là mức chọn để nhắc người pha, nằm trong phần Tùy chọn.

**Món có loại nóng và loại đá, công thức khác hẳn nhau thì sao?**
Bạn cứ coi "Nóng" và "Đá" như hai cỡ riêng — đặt tên cỡ là Nóng và Đá, rồi điền công thức cho mỗi loại, y như cách làm với cỡ M và cỡ L vậy.

**Tôi muốn sửa công thức đã lưu?**
Bạn mở món lên lại, vào đúng thẻ Quy cách — các con số cũ vẫn còn nguyên đó, bạn chỉnh rồi bấm Lưu lại là được.

**Có nhiều món, làm từng cái thì lâu?**
Với số lượng lớn, bạn có thể dùng nút **Nhập Excel** ở các trang nhóm món và danh sách món để tạo hàng loạt. Còn công thức theo cỡ thì nên làm trực tiếp trên web cho chắc.

---

Vậy là bạn đã nắm trọn cách cài đặt một quán FnB: từ nguyên liệu, nhóm món, tùy chọn, cho tới món có nhiều cỡ với công thức riêng. Chúc bạn làm thật trơn tru. Chỗ nào chưa rõ, bạn cứ hỏi quản lý nhé.
