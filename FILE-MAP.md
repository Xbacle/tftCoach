# 🗺 FILE MAP — Bản đồ dự án TFT 18 Helper

> Mỗi file/cặp file làm gì, ai dùng nó, thứ tự đọc khi học code.
> Dấu ⭐ = file quan trọng nhất (bắt buộc phải hiểu).

---

## 1. Gốc dự án

| File | Chức năng |
|---|---|
| ⭐ `server.js` | **Máy chủ chính** (Node thuần): gửi trang web từ `dist/`, 3 API (`/api/chat`, `/api/chat/stream` SSE, `/api/health`), chặn spam theo IP, chống đọc trộm đường dẫn. Toàn bộ nằm trong try/catch — yêu cầu lỗi không làm sập server |
| `package.json` | Khai báo tên dự án, lệnh tắt (`npm run dev/build/start`), danh sách thư viện |
| `package-lock.json` | Ghim đúng phiên bản thư viện — `npm ci` đọc file này để cài y hệt mọi máy |
| `index.html` | Trang HTML DUY NHẤT (SPA): chỉ có 1 div rỗng `#root`, JavaScript vẽ mọi thứ vào đó |
| `ecosystem.config.cjs` | Cấu hình PM2: tên app, cổng 3000, tự sống lại khi lỗi |
| `Dockerfile` | Đóng gói app thành container (2 tầng: build → chạy, image gọn) |
| `docker-compose.yml` | Chạy Docker bằng 1 lệnh `docker compose up -d`, kèm healthcheck + file key |
| `deploy.sh` | **Cập nhật production bằng 1 lệnh**: pull → npm ci → build → pm2 restart → health check |
| `.env.example` | Mẫu file khóa: `GEMINI_API_KEY`, `GEMINI_MODEL`, `PORT` |
| `.gitignore` | Loại `node_modules`, `dist`, `.env*` (khóa!), ảnh asset sinh tự động |
| `README.md` | Giới thiệu dự án + cách chạy local + kiến trúc AI |
| `DEPLOY.md` | Hướng dẫn deploy ngắn gọn (bản rút) |
| `HUONG-DAN-SETUP.md` | **Hướng dẫn đầy đủ từ số 0**: VPS, firewall, SSH, Nginx, domain, SSL, test tải, sự cố |
| `DATA_ANALYSIS.md`, `START_HERE*.md`, `V3/V5*.md` | Ghi chú phân tích dữ liệu + nhật ký các phiên bản cũ (tham khảo) |

## 2. `server/` — máy chủ

| File | Chức năng |
|---|---|
| ⭐ `chatCore.js` | **Bộ não AI**: system prompt (chỉ trả lời TFT, từ chối ngoài game), ghép lịch sử + RAG data, gọi Gemini (thường/stream), retry 3 lần với backoff, dự phòng 4 model, dự phòng phương thức |
| `rateLimit.js` | Chặn spam: 20 yêu cầu/phút mỗi IP, cửa sổ trượt 60s, đếm trong RAM |

## 3. `api/` — nền tảng Vercel (không dùng khi chạy VPS)

| File | Chức năng |
|---|---|
| `chat.js` | Cùng chức năng `/api/chat` viết kiểu serverless — giữ lại nếu muốn deploy miễn phí lên Vercel |

## 4. `src/ai/` — trí não AI phía client

| File | Chức năng |
|---|---|
| ⭐ `analyzer.js` | Đọc hiểu câu hỏi tiếng Việt: chuẩn hóa bỏ dấu/teencode, đoán ý định (hỏi đồ? đội hình?...), nhận diện tên tướng/item bằng Fuse.js, quyết định câu có phải về game không |
| ⭐ `retriever.js` | **Bộ RAG**: từ kết quả phân tích, lấy đúng mẩu dữ liệu JSON (tướng, đồ khuyên dùng, comp liên quan...) gói gọn gửi kèm câu hỏi; câu chung chung → gửi top 4 comp; câu ngoài game → không gửi gì |
| `geminiClient.js` | Gọi API máy chính: bản stream (đọc SSE từng mẩu, có đồng hồ 45s) + bản thường (dự phòng) |
| `fallback.js` | Khi AI chết hẳn: tự tạo câu trả lời từ dữ liệu local (danh sách comp/đồ) — người dùng vẫn có thông tin |
| `chatStorage.js` | Lưu/đọc lịch sử chat từ localStorage (bỏ phần dữ liệu nặng) |
| `text.js` | Tiện ích chữ: chuẩn hóa bỏ dấu, cắt mô tả quá dài |
| `aiConfig.js` | Hằng số: số lượt history, độ dài context, timeout |

## 5. `src/services/` — kho dữ liệu

| File | Chức năng |
|---|---|
| `dataLoader.jsx` | Nạp 4 tệp JSON **một lần** khi mở web (song song), phát cho toàn app qua React Context, kèm trạng thái lỗi |
| ⭐ `tftRepository.js` | **Thư viện tra cứu**: chỉ mục Map theo apiName (O(1)) + hàm quan hệ (tướng thuộc comp nào, đồ ghép từ gì, tộc có mấy tướng, thống kê comp) — cả web lẫn AI RAG đều hỏi lớp này |
| `assetRepository.js` | Trả đường dẫn ảnh đúng cho từng thực thể (ưu tiên WebP tối ưu, có fallback), nhận diện đồ Radiant |

## 6. `src/` — khung ứng dụng

| File | Chức năng |
|---|---|
| `main.jsx` | Cửa vào: gắn React vào div#root, bọc BrowserRouter + DataProvider |
| `App.jsx` | Định tuyến 10 đường + **ScrollToTop** (chuyển trang cuộn về đầu) |

## 7. `src/pages/` — 10 trang

| File | Trang | Chức năng |
|---|---|---|
| `HomePage.jsx` | `/` | Trang chủ: hero, thống kê nhanh, comp nổi bật, mục item |
| `CompsPage.jsx` | `/comps` | 24 đội hình mạnh: tìm kiếm, lọc, sắp theo hạng |
| `CompDetailPage.jsx` | `/comps/:id` | Chi tiết 1 đội hình: carry, tuyến sau, đồ lõi, mốc tộc hệ |
| `UnitsPage.jsx` | `/units` | Lưới 65 tướng: tìm kiếm + lọc giá/tộc/vai |
| `DetailPage.jsx` | `/units/:id`, `/items/:id`, `/traits/:id` | Trang chi tiết chung cho 3 loại (chỉ số, kỹ năng theo sao, đồ khuyên dùng, quan hệ) |
| `ItemsPage.jsx` | `/items` | Lưới 149 trang bị + công thức ghép |
| `TraitsPage.jsx` | `/traits` | 36 tộc hệ với mốc kích hoạt |
| `AugmentsPage.jsx` | `/augments` | 259 tăng cường: lọc bậc/vòng/hiệu ứng |
| `InfoPage.jsx` | `/info` | Bảng tỷ lệ shop theo cấp, pool size theo giá, thống kê augment, 10 bài cơ chế |
| `InfoTopicPage.jsx` | `/info/:slug` | 10 bài chi tiết cơ chế game (loot, encounter, cashout...) |

## 8. `src/components/` — các khối giao diện

### `ai/` — khung chat

| File | Chức năng |
|---|---|
| ⭐ `AIPanel.jsx` | **Khung chat**: gửi câu hỏi, nhận chữ hiện dần (update theo id), nút Dừng (abort), nút chat mới, lưu localStorage, trạng thái lỗi |
| `AIButton.jsx` | Nút tròn ✦ góc phải mở khung chat |
| `MarkdownText.jsx` | Render **đậm**/# tiêu đề/danh sách từ câu trả lời AI — bằng React nên an toàn XSS |

### `layout/`

| File | Chức năng |
|---|---|
| `AppShell.jsx` | Khung chung: Topbar + Sidebar + vùng nội dung (`children`), quản lý menu mobile |
| `Topbar.jsx` | Thanh trên: logo, nút ☰ mở menu mobile |
| `Sidebar.jsx` | Menu dọc 7 mục (NavLink tự highlight mục đang xem), footer trạng thái dữ liệu |

### `units/`, `items/`, `comps/`, `augments/`, `common/`

| File | Chức năng |
|---|---|
| `units/UnitImage.jsx` | Ảnh tướng (icon/splash) kèm fallback khi thiếu ảnh |
| `items/ItemIcon.jsx` | Ảnh trang bị + viền vàng riêng cho đồ Radiant |
| `comps/CompRow.jsx` | Card đội hình ở danh sách: tướng, tộc bật, đồ lõi, số liệu |
| `augments/AugmentCard.jsx` | Card tăng cường: ảnh full ô + badge bậc nhỏ ở góc |
| `augments/AugmentTierFrame.jsx` | Khung ảnh augment kèm hào quang theo bậc |
| `common/AssetImage.jsx` | Ảnh thông minh: src lỗi thì tự rớt xuống bản dự phòng |
| `common/Loading.jsx`, `ErrorState.jsx` | Màn hình chờ / báo lỗi thống nhất |
| `common/SearchBar.jsx`, `Chip.jsx`, `InfoCard.jsx`, `PlaceholderIcon.jsx` | Ô tìm kiếm, chip dữ liệu, card dẫn link, ảnh placeholder |
| `common/AbilityValues.jsx`, `TftValues.jsx` | Bảng giá trị kỹ năng theo số sao / bảng giá trị trong mô tả |

## 9. `src/utils/` — hàm tiện ích

| File | Chức năng |
|---|---|
| `tftText.js` | Phân tích mô tả game: thay `< TFTAttribute >` thành số thật, trích giá trị |
| `playerCopy.js` | Sinh câu văn thân thiện từ dữ liệu ("Ahri là tướng 4 giá · Part of Fae...") |
| `labels.js` | Đổi mã thành chữ người đọc (humanizeTag, rarityRank, roleLabel) |
| `format.js` | Định dạng số/phần trăm |
| `itemType.js` | Phân loại trang bị |

## 10. `src/styles/index.css` — hệ thống thiết kế

Một file duy nhất (~600 dòng): token màu, khung app, mọi class component (`.entity-card`, `.comp-row`, `.ai-panel`...), hiệu ứng augment Prismatic, màu viền theo giá tướng, responsive 4 mốc màn hình, hỗ trợ prefers-reduced-motion.

## 11. `public/data/` — dữ liệu (nguồn sự thật)

| Tệp | Nội dung |
|---|---|
| `Set18.json` | 81 tướng (chỉ số, kỹ năng, giá, pool), 36 tộc, 149 đồ, 259 augment, charms, encounters |
| `comps.json` | 24 cụm đội hình từ >170k trận: tướng, đồ lõi, hạng TB, xu hướng |
| `items_processed.json` | Trang bị xử lý: công thức ghép, độ phổ biến |
| `assets.json` + `augment_assets.json` | Bản đồ ảnh thực thể → file |

**Quy tắc vàng: thay tệp ở đây = cập nhật toàn bộ web + AI. Không sửa code.**

## 12. `public/assets/` — ảnh (WebP tối ưu)

`units/` (65 icon+splash) · `items/` (150) · `traits/` (37) · `augments/` (206 + 3 bộ rarity) · `home/`, `info/` (ảnh trang chủ/info) — tổng 99MB, gốc 780MB đã lược.

## 13. `scripts/` — công cụ dòng lệnh

| File | Chức năng |
|---|---|
| `sync_assets.py` | Điều phối: tải ảnh → nén WebP → cập nhật manifest (1 lệnh làm hết) |
| `download_assets.py` | Tải 574 ảnh gốc từ CDN (đa luồng 8) |
| `optimize_assets.py` | Nén WebP + ghi đường dẫn tối ưu vào assets.json (⚠️ đã sửa bug tiền tố `/public`) |
| `recolor_augment_icon.py` | Sinh 3 phiên bản màu augment theo bậc Bạc/Vàng/Quang phổ |
| `validate_data.py` | Kiểm tra JSON hợp lệ sau khi thay dữ liệu (`npm run data:validate`) |
| `download_units.py` | Tải riêng ảnh tướng |
| `mock-gemini.js` | **Gemini giả lập** cổng 8789 — test chat không tốn hạn mức |
| `load-test.js` | **Test tải**: mô phỏng N người truy cập/chat cùng lúc, đo req/s + độ trễ (xem HUONG-DAN-SETUP.md mục 11) |

## 14. `deploy/`

| File | Chức năng |
|---|---|
| `nginx.conf` | Cấu hình Nginx mẫu: reverse proxy :3000, **proxy_buffering off cho /api/** (stream), cache asset immutable |

---

## 🔄 Ba luồng dữ liệu chính (ghi nhớ nhanh)

```
LUỒNG XEM WEB:    public/data/*.json → dataLoader → tftRepository → pages hiển thị
LUỒNG CHAT:       câu hỏi → analyzer (hiểu) → retriever (lấy data) → server/chatCore (Gemini)
                  → SSE → AIPanel (chữ hiện dần) → lỗi thì fallback
LUỒNG CẬP NHẬT:   sửa code → GitHub Desktop push → VPS chạy ./deploy.sh → xong
```

**Thứ tự đọc code cho người mới**: `server.js` → `server/chatCore.js` → `src/services/dataLoader.jsx` → `tftRepository.js` → `src/ai/analyzer.js` → `retriever.js` → `geminiClient.js` → `AIPanel.jsx` → `App.jsx` → các trang → deploy files.
