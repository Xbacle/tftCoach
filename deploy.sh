#!/usr/bin/env bash
# ============================================================
# DEPLOY.SH — Cập nhật TFT 18 Helper trên VPS bằng MỘT lệnh
# Cách dùng: ssh vào VPS, cd /var/www/tft-helper rồi chạy:  ./deploy.sh
# ============================================================
set -e  # lỗi ở bước nào thì dừng ngay, không chạy tiếp

echo "==> [1/5] Tải code mới nhất từ GitHub..."
git pull origin main

echo "==> [2/5] Cài/cập nhật thư viện..."
npm ci

echo "==> [3/5] Build bản production..."
npm run build

echo "==> [4/5] Restart ứng dụng qua PM2..."
pm2 restart tft-helper-ai || pm2 start ecosystem.config.cjs

echo "==> [5/5] Kiểm tra sức khỏe..."
sleep 2
curl -s http://localhost:3000/api/health
echo ""
echo "✅ DEPLOY HOÀN TẤT — $(date)"
