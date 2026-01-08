---
description: Deploy code lên Vercel qua GitHub
---

# Hướng dẫn Deploy

Khi cần cập nhật website, chạy các lệnh sau trong Terminal:

// turbo-all

1. Thêm tất cả thay đổi:
```bash
git add .
```

2. Commit với mô tả:
```bash
git commit -m "Mô tả thay đổi của bạn"
```

3. Push lên GitHub (Vercel sẽ tự động deploy):
```bash
git push origin main
```

---

**Lưu ý:** Nếu gặp lỗi "git không được nhận diện", chạy lệnh này trước:
```powershell
$env:Path += ";C:\Program Files\Git\bin"
```
