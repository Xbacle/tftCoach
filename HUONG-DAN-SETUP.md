# HƯỚNG DẪN TRIỂN KHAI & VẬN HÀNH — TFT 18 HELPER (bản chi tiết đầy đủ)

> Tài liệu này là bản hướng dẫn **từ số không đến khi chạy thật**: mua VPS, mở cổng, cài đặt, nối tên miền,
> SSL, cập nhật tính năng bằng 1 lệnh, test tải 1000 người dùng, và xử lý sự cố.
> Sản phẩm tham chiếu: website chạy tại **https://tftcoach.io.vn** (VPS WiServices, Ubuntu 22.04).

---

## MỤC LỤC
1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Chuẩn bị trước khi triển khai](#2-chuẩn-bị)
3. [Mua VPS + mở cổng firewall](#3-vps--firewall)
4. [Đăng nhập SSH lần đầu](#4-ssh)
5. [Cài Node.js + Nginx + Certbot](#5-cài-đặt)
6. [Đưa code lên VPS (git clone)](#6-clone)
7. [API key + Build + PM2](#7-build--pm2)
8. [Cấu hình Nginx](#8-nginx)
9. [Trỏ tên miền + SSL Certbot](#9-domain--ssl)
10. [Cập nhật tính năng sau này — deploy.sh](#10-deploysh)
11. [Test tải — 1000 người truy cập cùng lúc](#11-test-tải)
12. [Sự cố thường gặp & cách xử lý](#12-sự-cố)

---

## 1. Tổng quan kiến trúc

```
Người dùng trình duyệt
        │  https://tftcoach.io.vn
        ▼
┌───────────────┐  cổng 80/443
│  DNS: bản ghi A  →  IP VPS (ví dụ 221.121.1.177)
│  NGINX (reverse proxy): kết thúc HTTPS, gửi file nhanh, chuyển tiếp /api/
└───────┬───────┘
        ▼  cổng 3000 (chỉ trong máy, không lộ ra ngoài)
┌───────────────┐
│ PM2 → node server.js   (1 tiến trình: gửi trang + 3 API chat)
└───────┬───────┘
        ▼  gọi ra ngoài khi có người chat
   Gemini API (miễn phí — nút thắt thật của hệ thống là hạn mức này)
```

- **Tại sao cần Nginx đứng trước?** Kết thúc HTTPS ở một nơi, phục vụ tệp tĩnh nhanh, ứng dụng thật (cổng 3000) không lộ ra Internet, sau này chạy nhiều web trên cùng máy theo tên miền được.
- **Tại sao cần PM2?** Chạy `npm start` tay gắn với cửa sổ SSH — đóng cửa sổ là web chết. PM2 chạy nền, tự sống lại khi lỗi, tự chạy khi VPS khởi động.

---

## 2. Chuẩn bị

| Thứ | Ghi chú |
|---|---|
| VPS Ubuntu 22.04/24.04 | Tối thiểu 1 vCPU/2GB; khuyến nghị 2 vCPU/4GB (build thoải mái). Cần quyền root + SSH |
| Tên miền | Ví dụ tftcoach.io.vn (đăng ký P.A Vietnam). Chỉ cần để trỏ DNS |
| Code trên GitHub | Repo private/public chứa dự án (vd `github.com/Xbacle/tftCoach`). Lưu ý: đã loại ảnh gốc nặng — repo ~94MB |
| Gemini API key | Lấy miễn phí tại https://aistudio.google.com/apikey |
| Token GitHub (repo private) | Settings → Developer settings → Personal access tokens → Tokens (classic) → tick `repo` → Generate. Chỉ hiện 1 lần, copy giữ |

---

## 3. VPS + Firewall

1. Tạo máy ảo Ubuntu 22.04 (WisServices: Compute → Tạo máy ảo → Chọn OS → Cấu hình 2vCPU/4GB/40GB → Thanh toán).
2. Nhận **IP** (vd `221.121.1.177`) + mật khẩu root (nút "Thông tin đăng nhập").
3. **Mở cổng** — panel hiện cảnh báo "Chưa có Firewall Rule" → tạo 3 quy tắc (hướng Đầu Vào, hành động ACCEPT, dùng Macro cho nhanh):
   - Macro `SSH` (cổng 22)
   - Macro `HTTP` (cổng 80)
   - Macro `HTTPS` (cổng 443)
   - IP Nguồn/Đích để trống = cho phép mọi nơi.

---

## 4. SSH

Từ máy cá nhân (PowerShell / terminal):

```powershell
ssh root@221.121.1.177
```
- Lần đầu hỏi `Are you sure...` → gõ `yes`
- Mật khẩu gõ **mù** (không hiện chữ) — bình thường
- ✅ Vào được dòng `root@tftv2:~#` là xong

Sau khi cài đặt xong nên `sudo reboot` một lần để nạp kernel mới, chờ ~60 giây rồi SSH lại.

---

## 5. Cài đặt

```bash
# Node.js 22 (chạy web)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update && sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx

# PM2 (trình quản lý tiến trình)
sudo npm i -g pm2

# Kiểm tra
node -v && pm2 -v && nginx -v
```
✅ `v22.x.x` + số pm2 + nginx version. Giữa lúc cài nếu Ubuntu hỏi restart service nào → gõ `3` (none of the above) hoặc Enter.

---

## 6. Clone

Repo **private** nên cần token trong URL (máy chủ không đăng nhập được bằng khác):

```bash
mkdir -p /var/www && cd /var/www
sudo git clone https://Xbacle:TOKEN_CUA_BAN@github.com/Xbacle/tftCoach.git tft-helper
sudo chown -R $USER:$USER /var/www/tft-helper
cd tft-helper && ls
```
✅ Thấy `src public server deploy deploy.sh Dockerfile package.json ...`

> Vì sao `/var/www`: đúng quy chuẩn mentor yêu cầu — code production đặt tại `/var/www/tên_dự_án`.
> Sau này đổi token mới (hết hạn 90 ngày):
> `git remote set-url origin https://Xbacle:TOKEN_MOI@github.com/Xbacle/tftCoach.git`

---

## 7. Build + PM2

```bash
# API key (chỉ nằm trên server, không lên GitHub)
printf 'GEMINI_API_KEY=AIza_key_that_cua_ban\n' > .env.local

# Cài thư viện + build (3-7 phút trên VPS 1 vCPU, đừng ngắt)
npm ci
npm run build

# Cho phép chạy deploy.sh
chmod +x deploy.sh

# PM2
pm2 start ecosystem.config.cjs
pm2 status          # phải thấy tft-helper-ai ONLINE
pm2 save
pm2 startup         # copy lệnh nó in ra, dán chạy lại
```

Kiểm tra:
```bash
curl -s http://localhost:3000/api/health
```
✅ `{"ok":true,"model":"gemini-3.6-flash","hasApiKey":true}` — thiếu key → xem mục 12.

---

## 8. Nginx

```bash
sudo cp /var/www/tft-helper/deploy/nginx.conf /etc/nginx/sites-available/tft-helper
sudo sed -i 's/server_name .*/server_name tftcoach.io.vn www.tftcoach.io.vn;/' /etc/nginx/sites-available/tft-helper
sudo ln -sf /etc/nginx/sites-available/tft-helper /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
✅ `syntax is ok` + `test is successful` → mở `http://221.121.1.177` thấy web.

**Khối quan trọng nhất** (đã có sẵn trong deploy/nginx.conf):
```nginx
location /api/ {
    proxy_buffering off;        # KHÔNG gom dữ liệu — chat mới hiện chữ dần (streaming)
    proxy_read_timeout 120s;
}
```

---

## 9. Domain + SSL

1. **P.A Vietnam** (trang quản lý tên miền) → Quản lý DNS → sửa bản ghi:
   - A `@` → IP mới của VPS
   - A `www` → IP mới của VPS
2. Kiểm tra DNS đã lan truyền (trên VPS hoặc máy cá nhân):
   ```bash
   getent hosts tftcoach.io.vn     # phải ra IP mới (cần apt-get install -y dnsutils nếu thiếu)
   ```
3. Cấp SSL:
   ```bash
   sudo certbot --nginx -d tftcoach.io.vn -d www.tftcoach.io.vn
   ```
   - Email → đồng ý ToS → chọn **Redirect** (HTTP tự nhảy sang HTTPS)
   - Nếu báo "Failed authorization" → DNS chưa lan truyền, chờ 5-10 phút chạy lại
   - Nếu báo "Could not find matching server block" → bước sửa `server_name` ở mục 8 chưa ăn, chạy lại lệnh sed rồi `certbot install --cert-name tftcoach.io.vn`
4. Kiểm tra:
   ```bash
   sudo certbot renew --dry-run    # thử gia hạn — phải OK
   curl -sI https://tftcoach.io.vn | head -3    # HTTP/2 200 (hoặc HTTP/1.1 200)
   ```

---

## 10. deploy.sh — cập nhật tính năng bằng 1 lệnh

File `deploy.sh` trong repo (đã `chmod +x`):
```bash
#!/usr/bin/env bash
set -e                                  # lỗi bước nào dừng ngay
git pull origin main                    # 1. kéo code mới
npm ci                                  # 2. cài thư viện
npm run build                           # 3. build
pm2 restart tft-helper-ai || pm2 start ecosystem.config.cjs   # 4. restart
curl -s http://localhost:3000/api/health                      # 5. kiểm tra
```

**Quy trình cập nhật tính năng (chuẩn 2 đầu):**

Máy cá nhân (GitHub Desktop):
1. Sửa code → tab **Changes** → gõ Summary → **Commit to main**
2. **Push origin**

VPS:
```bash
cd /var/www/tft-helper && ./deploy.sh
```
✅ Dòng cuối phải là `✅ DEPLOY HOÀN TẤT` + health check `hasApiKey:true`.

---

## 11. Test tải — 1000 người truy cập cùng lúc

Công cụ: `scripts/load-test.js` (viết bằng Node thuần, **không cần cài thêm gì**).

```bash
# Trên VPS — test trang chủ: 1000 yêu cầu, 50 chạy đồng thời
node scripts/load-test.js --url http://localhost:3000 --type static --n 1000 --c 50

# Test API health
node scripts/load-test.js --url http://localhost:3000 --type health --n 500 --c 50

# Từ máy cá nhân — test web qua Internet
node scripts/load-test.js --url https://tftcoach.io.vn --type static --n 200 --c 20
```

**Kết quả ví dụ (máy thật):**
```
Thời gian tổng   : 3.42s  (~292.4 yêu cầu/giây)
Thành công       : 1000  |  Lỗi mạng: 0
Mã trạng thái    : 200×1000
Độ trễ (ms)      : tb=168 | 50%=150 | 95%=310 | chậm nhất=520
```

**Cách đọc kết quả:**
- `yêu cầu/giây` càng cao càng tốt. Web tĩnh trên VPS 2vCPU thường đạt vài trăm đến >1000 req/s.
- `95%` (p95) là chỉ số quan trọng nhất: 95% người dùng chờ ít hơn con số này.
- Mã 200 đầy đủ = không có yêu cầu nào thất bại.

### Test chat AI (lưu ý quan trọng!)

```bash
# ⚠️ Mỗi câu chat tốn 1 hạn mức Gemini — CHỈ test ít (n ≤ 20) hoặc dùng mock:
node scripts/load-test.js --url http://localhost:3000 --type chat --n 10 --c 2 --msg "ahri cầm gì"
```

- Kết quả sẽ thấy **rất nhiều 429** — đó là **hành vi ĐÚNG**: rate limit 20 câu/phút/IP chặn lại để bảo vệ hạn mức Gemini miễn phí. Hệ thống không sập, chỉ từ chối lịch sự.
- **Nút thắt thật của hệ thống KHÔNG phải Node.js**: chat là công việc chờ I/O (đợi Gemini trả lời) — Node đơn luồng xử lý được hàng nghìn kết nối đồng thời kiểu này. Muốn 1000 người chat thật sự cùng lúc, phải nâng hạn mức Gemini (gói trả phí) + cache câu trả lời — chưa phải nâng server.
- Test stream không tốn hạn mức: dùng mock Gemini (chạy `node scripts/mock-gemini.js` ở máy local, rồi trỏ `GEMINI_API_ROOT=http://127.0.0.1:8789/v1beta` khi khởi động server).

---

## 12. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| `/api/health` trả `hasApiKey:false` | Thiếu `.env.local` hoặc key sai | Sửa file → `pm2 restart tft-helper-ai --update-env` |
| Web hiện màn hình trắng | Chưa build | `npm run build` trong thư mục code |
| 502 Bad Gateway | App chưa chạy | `pm2 status` → `pm2 logs tft-helper-ai` |
| Chat không stream (đợi rồi hiện 1 cục) | Nginx buffering | Kiểm tra `proxy_buffering off` trong khối `/api/` |
| Chat báo thiếu API key | `.env.local` sai/thiếu | `cat .env.local` kiểm tra → restart PM2 |
| Certbot "Failed authorization" | DNS chưa lan truyền / trỏ sai IP | `getent hosts tên_miền` kiểm tra, chờ 5-10 phút |
| Certbot "no matching server block" | `server_name` trong Nginx chưa đúng tên miền | `sudo sed -i 's/server_name .*/server_name tên_miền;/' ...` → `certbot install --cert-name ...` |
| `git pull` xin mật khẩu | Token hết hạn (90 ngày) | `git remote set-url origin https://Xbacle:TOKEN_MOI@github.com/...` |
| `git pull` xung đột | Đã sửa code trực tiếp trên VPS | `git stash` → chạy lại `./deploy.sh` |
| npm run build bị kill | RAM không đủ (VPS 1GB) | Nâng lên 2GB+, hoặc thêm swap |

---

## Lệnh vận hành hữu ích

```bash
pm2 status                    # app đang chạy thế nào
pm2 logs tft-helper-ai        # xem log trực tiếp (Ctrl+C thoát)
pm2 restart tft-helper-ai     # khởi động lại ứng dụng
sudo systemctl reload nginx   # nạp lại cấu hình Nginx
sudo nginx -t                 # kiểm tra cấu hình Nginx trước khi reload
df -h                         # dung lượng đĩa còn lại
free -h                       # RAM còn lại
```
