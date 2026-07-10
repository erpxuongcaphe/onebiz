# Hướng dẫn pha chế theo kích cỡ
**Dành cho nhân viên — quán cà phê OneBiz**

Chào bạn! Bài hướng dẫn này sẽ giúp bạn khai báo cho phần mềm biết **mỗi cỡ ly cần bao nhiêu nguyên liệu**, để khi bán hàng, phần mềm tự động trừ kho cho thật chính xác. Bạn cứ đọc thong thả, vừa đọc vừa làm theo là được, không có gì khó đâu.

---

## 1. Vì sao mình cần làm việc này?

Bạn hãy hình dung quán mình bán món cà phê sữa, có hai cỡ ly: **cỡ vừa (M)** và **cỡ lớn (L)**.

Hai cỡ này không chỉ khác nhau ở cái ly, mà còn khác cả lượng nguyên liệu bên trong: ly lớn thì đương nhiên nhiều cà phê hơn, nhiều sữa hơn. Vậy nên nếu mình chỉ khai một công thức chung cho cả hai cỡ, kho sẽ bị tính sai — bán ly lớn mà chỉ trừ như ly nhỏ, lâu dần số liệu lệch hết.

<svg viewBox="0 0 640 300" width="640" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">
  <rect x="0" y="0" width="640" height="300" fill="#ffffff"/>
  <text x="320" y="32" text-anchor="middle" font-size="18" font-weight="bold" fill="#1e3a5f">Cùng một món, mỗi cỡ một công thức riêng</text>
  <rect x="40" y="58" width="255" height="200" rx="14" fill="#f1f7ff" stroke="#bcd7f5" stroke-width="1.5"/>
  <path d="M 108 92 L 182 92 L 174 150 L 116 150 Z" fill="#cfa07a" stroke="#8a5a3b" stroke-width="2"/>
  <path d="M 116 150 L 174 150 L 171 168 L 119 168 Z" fill="#8a5a3b"/>
  <text x="167" y="120" text-anchor="middle" font-size="13" fill="#3b2a1d">M</text>
  <text x="167" y="192" text-anchor="middle" font-size="15" font-weight="bold" fill="#1e3a5f">Cỡ M (vừa)</text>
  <text x="64" y="216" font-size="13" fill="#374151">• Cà phê: 18 g</text>
  <text x="64" y="236" font-size="13" fill="#374151">• Sữa: 80 ml</text>
  <text x="64" y="256" font-size="13" fill="#374151">• Ly nhỏ: 1 cái</text>
  <rect x="345" y="58" width="255" height="200" rx="14" fill="#eafaf1" stroke="#a8e0c2" stroke-width="1.5"/>
  <path d="M 405 84 L 495 84 L 485 152 L 415 152 Z" fill="#cfa07a" stroke="#8a5a3b" stroke-width="2"/>
  <path d="M 415 152 L 485 152 L 482 172 L 418 172 Z" fill="#8a5a3b"/>
  <text x="475" y="118" text-anchor="middle" font-size="14" fill="#3b2a1d">L</text>
  <text x="472" y="196" text-anchor="middle" font-size="15" font-weight="bold" fill="#136f43">Cỡ L (lớn)</text>
  <text x="369" y="220" font-size="13" fill="#374151">• Cà phê: 25 g</text>
  <text x="369" y="240" font-size="13" fill="#374151">• Sữa: 120 ml</text>
  <text x="369" y="260" font-size="13" fill="#374151">• Ly lớn: 1 cái</text>
  <text x="320" y="288" text-anchor="middle" font-size="13" fill="#6b7280">Bán cỡ nào, phần mềm tự trừ kho đúng cỡ đó.</text>
</svg>

Cách làm đúng là: **mỗi cỡ ly, mình ghi một công thức riêng.** Khi thu ngân bán một ly cỡ nào, phần mềm sẽ nhìn đúng công thức của cỡ đó mà trừ kho. Nghe thì có vẻ phức tạp, nhưng bạn sẽ thấy làm rất nhanh thôi.

---

## 2. Năm bước thực hiện

Toàn bộ công việc gói gọn trong năm bước, và điều dễ chịu nhất là: **chỉ cần bấm Lưu một lần duy nhất** ở cuối.

<svg viewBox="0 0 680 150" width="680" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">
  <defs>
    <marker id="ar" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#9aa7b8"/>
    </marker>
  </defs>
  <rect width="680" height="150" fill="#ffffff"/>
  <line x1="86"  y1="48" x2="172" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="222" y1="48" x2="308" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="358" y1="48" x2="444" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <line x1="494" y1="48" x2="580" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#ar)"/>
  <circle cx="60"  cy="48" r="26" fill="#2563eb"/><text x="60"  y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">1</text>
  <circle cx="197" cy="48" r="26" fill="#2563eb"/><text x="197" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">2</text>
  <circle cx="334" cy="48" r="26" fill="#2563eb"/><text x="334" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">3</text>
  <circle cx="471" cy="48" r="26" fill="#2563eb"/><text x="471" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">4</text>
  <circle cx="608" cy="48" r="26" fill="#16a34a"/><text x="608" y="55" text-anchor="middle" font-size="18" font-weight="bold" fill="#ffffff">5</text>
  <text x="60"  y="100" text-anchor="middle" font-size="13" fill="#374151">Mở món</text>
  <text x="197" y="100" text-anchor="middle" font-size="13" fill="#374151">Thêm các cỡ</text>
  <text x="334" y="100" text-anchor="middle" font-size="13" fill="#374151">Bật công thức</text>
  <text x="471" y="100" text-anchor="middle" font-size="13" fill="#374151">Điền bảng</text>
  <text x="608" y="100" text-anchor="middle" font-size="13" font-weight="bold" fill="#16803d">Bấm Lưu</text>
  <text x="608" y="120" text-anchor="middle" font-size="11" fill="#6b7280">(một lần)</text>
</svg>

### Bước 1 — Mở món cần khai báo
Bạn vào mục **Hàng hóa**, tìm tên món của mình, rồi bấm nút **Sửa** để mở món lên.

Nếu món đang để ngừng bán mà bạn không thấy nó trong danh sách, hãy chọn bộ lọc trạng thái thành **"Tất cả"**, món sẽ hiện ra ngay.

### Bước 2 — Khai báo các cỡ ly
Bạn bấm sang thẻ **Quy cách**, rồi bấm **Thêm quy cách**. Mỗi cỡ ly là một dòng:

- Ô **Tên**: gõ tên cỡ, ví dụ M, L, hay XL.
- Ô **Giá bán**: gõ giá của cỡ đó (phần mềm tự thêm dấu chấm ngăn cách hàng nghìn cho bạn dễ nhìn).

Cứ thêm cho đủ các cỡ mà món có. Cỡ nào hay bán nhất thì bạn đánh dấu **Mặc định**.

### Bước 3 — Bật phần công thức
Ngay bên dưới danh sách cỡ ly, bạn sẽ thấy một ô tích nhỏ: **"Trừ kho theo công thức từng size"**. Bạn tích vào đó. Lập tức một cái bảng hiện ra để bạn điền công thức.

### Bước 4 — Điền công thức cho từng cỡ
Đây là phần chính, nhưng rất trực quan. Bảng có một cột ghi tên nguyên liệu, một cột đơn vị, và **mỗi cỡ ly một cột riêng**.

Với mỗi nguyên liệu, bạn làm ba việc nhỏ:

1. Ở cột **Nguyên liệu**, bạn gõ vài chữ để tìm rồi chọn (ví dụ gõ "sữa" là phần mềm lọc ra cho bạn chọn cho nhanh).
2. Phần mềm **tự điền sẵn đơn vị** của nguyên liệu đó, bạn không phải nhớ.
3. Sau đó, ở cột của từng cỡ, bạn gõ **lượng cần dùng** cho cỡ đó. Lượng được phép có số lẻ, ví dụ 0,5.

Một mẹo nhỏ giúp bạn nhanh hơn: nếu các cỡ chỉ khác nhau chút ít, bạn điền cho cỡ đầu tiên trước, rồi bấm nút **"Gợi ý: copy cỡ M sang cỡ khác"** để phần mềm điền sẵn, sau đó bạn chỉnh lại vài chỗ là xong.

Khi điền xong, ở cuối bảng phần mềm còn **tự tính giá vốn cho từng cỡ** giúp bạn — rất tiện để biết mỗi ly tốn bao nhiêu tiền nguyên liệu.

### Bước 5 — Bấm Lưu một lần
Cuối cùng, bạn bấm nút **Lưu** ở góc dưới. Chỉ một lần bấm này thôi là **cả các cỡ ly lẫn công thức đều được lưu cùng lúc** — không phải lưu hai lần như trước nữa.

### Còn khi bán hàng thì sao?
Lúc bán, thu ngân chỉ việc chọn cỡ ly khách muốn. Phần mềm tự nhìn công thức của đúng cỡ đó để trừ kho. Bạn không phải làm gì thêm cả.

---

## 3. Một ví dụ cho dễ hình dung

Giả sử món "Cà phê sữa" của mình có hai cỡ, công thức như sau:

| Nguyên liệu | Cỡ M | Cỡ L |
|-------------|:----:|:----:|
| Cà phê | 18 g | 25 g |
| Sữa tươi | 80 ml | 120 ml |
| Ly nhỏ | 1 cái | — |
| Ly lớn | — | 1 cái |

Đọc bảng này, ta hiểu: bán một ly **cỡ M** thì trừ 18 g cà phê, 80 ml sữa và một ly nhỏ; còn ly **cỡ L** thì trừ 25 g cà phê, 120 ml sữa và một ly lớn.

Bạn để ý dòng cái ly nhé: cỡ M dùng ly nhỏ, cỡ L dùng ly lớn — đó chính là lý do vì sao mỗi cỡ phải có công thức riêng, chứ không thể lấy cỡ này nhân lên thành cỡ kia được.

---

## 4. Vài điều cần nhớ

- **Đá thì không khai vào đây.** Đá chỉ là ghi chú để mình pha cho đúng, không tính vào kho. Phần đá, mức đường hay topping nằm ở mục Tùy chọn riêng, không thuộc bảng công thức này.

- **Đừng để trống cỡ nào.** Nếu một cỡ chưa điền nguyên liệu, khi bán cỡ đó phần mềm sẽ không biết trừ gì cả. Nhớ điền đủ cho mọi cỡ.

- **Nếu sau này cần sửa**, bạn chỉ việc mở món lên lại, vào đúng thẻ Quy cách — các con số cũ vẫn còn nguyên đó, bạn chỉnh rồi bấm Lưu lại là được.

- **Trường hợp món có loại nóng và loại đá mà công thức khác hẳn nhau** (ví dụ bản đá tốn nhiều cà phê và đá hơn): bạn cứ coi "Nóng" và "Đá" như hai cỡ riêng — đặt tên cỡ là Nóng và Đá, rồi điền công thức cho mỗi loại, y như cách làm với cỡ M và L vậy.

---

Vậy là xong rồi! Chúc bạn khai báo thật trơn tru. Chỗ nào chưa rõ, bạn cứ hỏi quản lý nhé.
