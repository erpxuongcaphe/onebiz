# Hướng dẫn cài đặt OneBiz từ A đến Z
**Cẩm nang setup toàn bộ cho quán — dành cho chủ quán / quản lý / nhân viên**

Chào bạn! Đây là tài liệu đi cùng bạn từ lúc bắt đầu cho tới khi quán chạy được trên phần mềm: từ nguyên liệu trong kho, hàng hóa, công thức pha chế, menu quán, cho tới sơ đồ bàn và bán thử. Bạn cứ làm tuần tự từng phần, xong phần nào chắc phần đó. Mọi thứ đều làm trên web, không cần biết kỹ thuật.

> Tài liệu này gộp chung và thay cho các bản hướng dẫn rời trước đây (nguyên liệu, hàng hóa, công thức, FnB, sơ đồ bàn), và đã được cập nhật đúng theo phần mềm hiện tại.

---

## Bức tranh tổng thể — làm theo thứ tự này

Để quán chạy mượt, mình đi theo năm chặng. Mỗi chặng là nền cho chặng sau, nên bạn cứ làm lần lượt từ trái sang phải:

<svg viewBox="0 0 690 150" width="690" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">
  <defs><marker id="a0" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#9aa7b8"/></marker></defs>
  <rect width="690" height="150" fill="#ffffff"/>
  <line x1="92" y1="48" x2="178" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#a0)"/>
  <line x1="230" y1="48" x2="316" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#a0)"/>
  <line x1="368" y1="48" x2="454" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#a0)"/>
  <line x1="506" y1="48" x2="592" y2="48" stroke="#9aa7b8" stroke-width="2" marker-end="url(#a0)"/>
  <circle cx="62" cy="48" r="26" fill="#b45309"/><text x="62" y="55" text-anchor="middle" font-size="17" font-weight="bold" fill="#ffffff">1</text>
  <circle cx="204" cy="48" r="26" fill="#1d4ed8"/><text x="204" y="55" text-anchor="middle" font-size="17" font-weight="bold" fill="#ffffff">2</text>
  <circle cx="342" cy="48" r="26" fill="#1d4ed8"/><text x="342" y="55" text-anchor="middle" font-size="17" font-weight="bold" fill="#ffffff">3</text>
  <circle cx="480" cy="48" r="26" fill="#1d4ed8"/><text x="480" y="55" text-anchor="middle" font-size="17" font-weight="bold" fill="#ffffff">4</text>
  <circle cx="618" cy="48" r="26" fill="#16a34a"/><text x="618" y="55" text-anchor="middle" font-size="17" font-weight="bold" fill="#ffffff">5</text>
  <text x="62" y="98" text-anchor="middle" font-size="12.5" fill="#374151">Nguyên liệu</text>
  <text x="204" y="98" text-anchor="middle" font-size="12.5" fill="#374151">Hàng hóa &amp;</text>
  <text x="204" y="114" text-anchor="middle" font-size="12.5" fill="#374151">công thức</text>
  <text x="342" y="98" text-anchor="middle" font-size="12.5" fill="#374151">Menu quán</text>
  <text x="342" y="114" text-anchor="middle" font-size="12.5" fill="#374151">FnB</text>
  <text x="480" y="98" text-anchor="middle" font-size="12.5" fill="#374151">Sơ đồ bàn</text>
  <text x="618" y="98" text-anchor="middle" font-size="12.5" font-weight="bold" fill="#16803d">Bán thử</text>
</svg>

Trước khi đi vào chi tiết, bạn nắm ba khái niệm gốc, vì cả hệ thống xoay quanh chúng:

- **Nguyên liệu** — thứ thô trong kho: cà phê, sữa, đường, ly, ống hút… Nguyên liệu **không bán trực tiếp** cho khách, chỉ để pha món.
- **Hàng hóa** — thứ **bán cho khách**: một ly cà phê, một gói cà phê rang, một cái bánh.
- **Công thức** — bản ghi "để làm ra một món thì tốn những nguyên liệu nào, mỗi thứ bao nhiêu". Nhờ công thức, mỗi lần bán phần mềm **tự trừ kho** đúng nguyên liệu.

---

## Phần 1 — Nhập nguyên liệu vào kho

Việc đầu tiên là cho phần mềm biết quán có những nguyên liệu gì. Bạn vào mục **Hàng hóa**, chọn thẻ **Nguyên vật liệu**, rồi bấm **Tạo mới** để thêm từng thứ: tên nguyên liệu, đơn vị tính (kg, lít, cái…), và giá vốn (giá mình mua vào).

Bạn cứ thêm đủ những thứ quán dùng để pha chế: cà phê, sữa, đường, syrup, trân châu, ly các cỡ, ống hút, nắp ly… Khi nhập hàng về sau, tồn kho của các nguyên liệu này sẽ tăng lên; mỗi lần bán món, nó sẽ tự giảm theo công thức.

> Nếu danh sách dài, bạn dùng nút **Nhập Excel**: bấm "Tải mẫu", điền vào file rồi tải lên — tạo cả trăm nguyên liệu một lần cho nhanh.

---

## Phần 2 — Hàng hóa bán và công thức

Phần này dành cho những thứ mình bán nguyên (gói cà phê rang, chai nước, bánh) hoặc cần khai công thức sản xuất. Nếu quán bạn chỉ bán đồ uống pha tại quán, bạn có thể đọc lướt phần này và sang thẳng Phần 3.

### Tạo một mặt hàng
Bạn vào **Hàng hóa**, bấm **Tạo mới**, chọn loại **Hàng bán**. Điền tên, chọn nhóm, đơn vị bán và giá bán.

### Khai công thức cho mặt hàng
Nếu mặt hàng đó được làm ra từ nguyên liệu (ví dụ một gói cà phê rang làm từ cà phê hạt sống), bạn vào thẻ **Công thức** của mặt hàng, bật **Có công thức**, rồi thêm các nguyên liệu cùng lượng dùng. Từ đó, mỗi lần bán hoặc sản xuất, phần mềm tự trừ kho nguyên liệu.

Có một điều rất tiện: **giá vốn của món được phần mềm tự tính** từ công thức (cộng giá các nguyên liệu lại), bạn không phải nhập tay. Và một công thức có thể **dùng chung cho nhiều mặt hàng** — sửa công thức một lần, mọi mặt hàng dùng nó đều cập nhật theo.

> Trường hợp một quán muốn pha khác quán kia, bạn có thể tạo **công thức riêng cho từng chi nhánh**. Phần mềm sẽ ưu tiên công thức riêng của quán đó, nếu không có thì dùng công thức chung.

---

## Phần 3 — Cài đặt menu quán FnB

Đây là phần quan trọng nhất với quán cà phê / trà sữa. Bạn hãy hình dung: khách gọi một **món**, món thuộc một **nhóm**, có thể có nhiều **cỡ ly**, mỗi cỡ một **công thức** riêng, và khách còn dặn thêm vài **tùy chọn** (đường, đá, topping).

### 3.1 — Tạo nhóm món
Mỗi món phải nằm trong một nhóm (Cà phê, Trà sữa, Sinh tố…). Nhóm giúp máy POS chia tab cho dễ bấm và giúp xem báo cáo theo loại.

Bạn vào **Danh mục → Nhóm hàng**, chuyển sang thẻ **Hàng bán**, bấm **Tạo mới**, và nhớ chọn **Kênh bán là FnB** — chỉ món thuộc kênh FnB mới hiện trên máy POS của quán.

### 3.2 — Tạo các tùy chọn (mức đường, mức đá, topping)
"Tùy chọn" là những điều khách hay dặn thêm. Phần mềm có sẵn một bộ mẫu, bạn chỉ cần bấm một nút. Vào **Danh mục → Tuỳ chọn món FnB**, bấm **Tạo bộ tuỳ chọn mẫu**. Chỉ sau một giây, hệ thống tạo ba nhóm:

| Tùy chọn | Các lựa chọn | Có trừ kho không? |
|----------|--------------|-------------------|
| **Mức đường** | Không đường · 60% · 80% · 100% | Có — trừ đúng định lượng đã cân cho lựa chọn khách chọn |
| **Mức đá** | Không đá · Ít · Vừa · Nhiều | Không — chỉ là lời nhắc cho người pha |
| **Topping** | (bạn tự thêm) | Có — mỗi topping trừ nguyên liệu riêng |

Ba điều cần nhớ ở đây:
- **Mức đường** có trừ kho chính xác: mỗi món tự có bảng định lượng riêng. Ví dụ Hồng Trà 80% có thể trừ 28 g đường, nhưng món khác 80% không bị ép dùng cùng tỷ lệ.
- **Mức đá** chỉ là lời nhắc, **không** trừ kho. Đá không tính vào nguyên liệu.
- **Topping** (trân châu, thạch…) thì mỗi loại có nguyên liệu riêng, bán kèm sẽ trừ riêng.

Bộ tùy chọn này chỉ tạo **một lần** cho cả quán. Sau đó vào **Danh mục → Nhóm hàng**, mở từng nhóm món và tích các tùy chọn phù hợp. Khi đã gán cho nhóm, mọi món trong nhóm **tự thừa kế**, bạn không phải gán lại từng món.

> **Lưu ý quan trọng:** cỡ ly (M, L) **không** nằm trong phần tùy chọn này. Cỡ ly là "quy cách" của món, khai ngay trong từng món (mục 3.3) — nhờ vậy mỗi cỡ mới có công thức riêng được.

### 3.3 — Tạo món, khai cỡ ly và công thức theo cỡ
Bạn hãy hình dung quán bán cà phê sữa, có hai cỡ: **cỡ vừa (M)** và **cỡ lớn (L)**. Hai cỡ khác nhau không chỉ cái ly, mà cả lượng nguyên liệu — ly lớn nhiều cà phê và sữa hơn.

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

Vì thế mỗi cỡ ly mình ghi một công thức riêng. Việc này gói gọn trong năm bước nhỏ, và điều dễ chịu nhất là **chỉ bấm Lưu một lần** ở cuối:

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

**Bước 1 — Tạo món.** Vào **Hàng hóa**, bấm **Tạo mới**, chọn loại **Hàng bán**. Điền tên món, chọn nhóm, chọn **Kênh bán là FnB**. Giá vốn để trống (phần mềm tự tính từ công thức). Lưu để món có mặt.

**Bước 2 — Khai các cỡ ly.** Mở món lên, sang thẻ **Quy cách**, bấm **Thêm quy cách** cho mỗi cỡ: gõ tên (M, L), gõ giá bán. Cỡ hay bán nhất thì đánh dấu **Mặc định**.

> **"Nóng" và "Đá" cũng khai ở đây như một cỡ.** Nếu bản nóng và bản đá pha khác công thức (đá thường nhiều cà phê và ly to hơn), bạn cứ đặt tên cỡ là "Nóng", "Đá" — hoặc gộp cả cỡ ly thành "M Nóng", "M Đá", "L Nóng", "L Đá" — rồi điền công thức cho mỗi loại, y như cách làm với cỡ M và L. Còn nếu nóng/đá chỉ khác chút đá mà công thức như nhau, thì để nó ở phần tùy chọn "Mức đá" cho gọn.

**Bước 3 — Bật công thức.** Ngay dưới danh sách cỡ, có ô tích **"Trừ kho theo công thức từng cỡ"**. Tích vào đó, một cái bảng hiện ra.

**Bước 4 — Điền công thức cho từng cỡ.** Bảng có cột nguyên liệu, cột đơn vị, và mỗi cỡ một cột. Với mỗi nguyên liệu: gõ vài chữ để tìm rồi chọn (phần mềm tự điền đơn vị), sau đó gõ lượng cho từng cỡ (cho phép số lẻ như 0,5). Với đường hoặc syrup thay đổi theo lựa chọn, gắn nhóm **Mức đường**, lưu BOM, rồi mở lại BOM và bật **Dùng định lượng riêng** để nhập số đã cân cho từng mức. Nhập `0` cho "Không đường". Cuối bảng phần mềm tự tính giá vốn từng cỡ giúp bạn.

**Bước 5 — Bấm Lưu một lần.** Một lần bấm Lưu là cả cỡ ly lẫn công thức đều được lưu cùng lúc.

> **Ví dụ — món "Cà phê sữa" hai cỡ:**

| Nguyên liệu | Cỡ M | Cỡ L |
|-------------|:----:|:----:|
| Cà phê | 18 g | 25 g |
| Sữa tươi | 80 ml | 120 ml |
| Ly nhỏ | 1 cái | — |
| Ly lớn | — | 1 cái |

Bán một ly cỡ M trừ 18 g cà phê, 80 ml sữa, một ly nhỏ; cỡ L trừ 25 g cà phê, 120 ml sữa, một ly lớn. Để ý dòng cái ly: cỡ M dùng ly nhỏ, cỡ L dùng ly lớn — đó là lý do mỗi cỡ phải có công thức riêng.

> **Món có loại nóng và loại đá khác công thức?** Cứ coi "Nóng" và "Đá" như hai cỡ riêng — đặt tên cỡ là Nóng và Đá rồi điền công thức cho mỗi loại.

---

## Phần 4 — Vẽ sơ đồ bàn

Nếu quán có chỗ ngồi, sơ đồ bàn giúp nhân viên nhìn một cái là biết bàn nào trống, bàn nào có khách, để phục vụ nhanh và đỡ nhầm.

<svg viewBox="0 0 560 220" width="560" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">
  <rect width="560" height="220" fill="#ffffff"/>
  <rect x="20" y="20" width="520" height="180" rx="12" fill="#fafafa" stroke="#e5e7eb"/>
  <rect x="40" y="34" width="120" height="26" rx="6" fill="#eef2ff"/>
  <text x="100" y="51" text-anchor="middle" font-size="12" fill="#3730a3">Khu vực: Sảnh 1</text>
  <circle cx="110" cy="120" r="30" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>
  <text x="110" y="125" text-anchor="middle" font-size="13" fill="#475569">A1</text>
  <text x="110" y="168" text-anchor="middle" font-size="11" fill="#94a3b8">trống</text>
  <circle cx="220" cy="120" r="30" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <text x="220" y="125" text-anchor="middle" font-size="13" fill="#1e40af">A2</text>
  <text x="220" y="168" text-anchor="middle" font-size="11" fill="#2563eb">có khách</text>
  <rect x="305" y="92" width="56" height="56" rx="6" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>
  <text x="333" y="125" text-anchor="middle" font-size="13" fill="#475569">B1</text>
  <text x="333" y="168" text-anchor="middle" font-size="11" fill="#94a3b8">trống</text>
  <rect x="430" y="80" width="80" height="80" rx="10" fill="#f0fdf4" stroke="#86efac" stroke-width="2"/>
  <text x="470" y="116" text-anchor="middle" font-size="11" fill="#15803d">Quầy</text>
  <text x="470" y="132" text-anchor="middle" font-size="11" fill="#15803d">pha chế</text>
</svg>

Bạn vào **Hệ thống → Sơ đồ bàn**. Cách dựng rất giống xếp hình:

1. **Chọn tầng** ở thanh trên (Trệt, Lầu 1…). Mỗi tầng có sơ đồ riêng.
2. **Thêm khu vực** (Sảnh 1, Sân vườn, Phòng VIP) — mỗi khu vực là một mặt bằng riêng.
3. **Đặt bàn**: bên trái có sẵn nhiều mẫu bàn (tròn, vuông, dài, sofa). Bấm một mẫu là bàn hiện ra, bạn kéo tới đúng chỗ. Bấm vào bàn để **đặt tên** (A1, B2, VIP-1).
4. **Thêm đồ trang trí**: quầy bar, cửa, cây cảnh, tường… để sơ đồ giống quán thật.
5. **(Tùy chọn) Tải ảnh chụp quán** làm nền để đối chiếu cho chính xác.

Vài thao tác hữu ích: kéo để di chuyển, kéo các chấm quanh bàn để co dãn, bấm khóa để cố định bàn khỏi xê dịch, và Ctrl+Z để hoàn tác nếu lỡ tay. Xong xuôi bạn có thể **In** sơ đồ ra giấy dán ở quầy.

Khi bán hàng, nhân viên mở máy POS của quán, vào thẻ **Sơ đồ bàn**, chạm vào một bàn là hiện ra các lựa chọn: mở đơn mới, xem đơn đang phục vụ, gộp bàn, hay chuyển bàn. Màu bàn tự đổi theo trạng thái và đồng bộ giữa các máy trong vài giây.

> Mẹo: phác trên giấy trước rồi mới dựng trên web sẽ nhanh hơn nhiều. Và nên setup vào giờ vắng khách để tránh thao tác nhầm.

---

## Phần 5 — Bán thử để kiểm tra

Sau khi xong, bạn nên bán thử một ly để chắc chắn mọi thứ chạy đúng.

Mở **máy POS của quán**, chọn món vừa tạo. Một bảng hiện ra: chọn **cỡ ly** (giá tự đổi theo cỡ), chọn **mức đường, mức đá**, thêm topping nếu cần. Bấm thêm vào đơn rồi thanh toán.

Xong, quay lại **Hàng hóa → Nguyên vật liệu**, tìm nguyên liệu vừa dùng (ví dụ sữa) và xem tồn kho — nó phải **giảm đúng bằng lượng trong công thức của cỡ bạn vừa bán**. Nếu đúng vậy là bạn đã thành công trọn vẹn.

---

## Phần 6 — Những câu hỏi hay gặp

**Bán một ly mà kho không trừ?**
Thường vì món chưa có công thức, hoặc quên bật ô "Trừ kho theo công thức từng cỡ". Mở món lên kiểm tra lại thẻ Quy cách.

**Món vừa tạo không thấy trên máy POS?**
Kiểm tra kênh bán của món có phải FnB không, và món có đang ở trạng thái đang bán không. Nếu vẫn chưa thấy, thử tải lại trang.

**Đá khai ở đâu?**
Đá không khai vào công thức vì không tính vào kho. Đá chỉ là mức chọn nhắc người pha, nằm trong phần Tùy chọn.

**Muốn sửa công thức đã lưu?**
Mở món lên lại, vào thẻ Quy cách — các con số cũ vẫn còn nguyên, bạn chỉnh rồi Lưu lại.

**Nhân viên không thấy nút Sửa ở sơ đồ bàn?**
Vì tài khoản đó chưa được cấp quyền chỉnh sơ đồ. Quản trị viên cấp quyền là được; còn nhân viên thu ngân thì chỉ cần xem là đủ.

**Có rất nhiều món / nguyên liệu, làm tay thì lâu?**
Ở các trang nguyên liệu, nhóm món và danh sách hàng hóa đều có nút **Nhập Excel** để tạo hàng loạt. Riêng công thức theo cỡ thì nên làm trực tiếp trên web cho chắc.

---

Vậy là bạn đã đi trọn một vòng cài đặt: từ nguyên liệu, hàng hóa, công thức, menu quán, cho tới sơ đồ bàn và bán thử. Chúc bạn làm thật trơn tru. Chỗ nào chưa rõ, bạn cứ hỏi quản lý nhé.
