#!/usr/bin/env node
// ============================================================
// LOAD TEST — mô phỏng nhiều người dùng truy cập cùng lúc
// Dùng (không cần cài thêm gì):
//   node scripts/load-test.js --url http://localhost:3000 --type static --n 200 --c 20
//   node scripts/load-test.js --url https://tftcoach.io.vn --type health --n 100 --c 10
//   node scripts/load-test.js --url http://localhost:3000 --type chat --n 10 --c 2 --msg "ahri cầm gì"
//
// Kiểu test:
//   static  : GET /            (tải trang chủ — đo năng lực phục vụ web)
//   health  : GET /api/health  (đo API nhanh)
//   chat    : POST /api/chat   (HỎI AI THẬT — tốn hạn mức Gemini, đừng chạy n lớn!)
// ============================================================

const args = process.argv.slice(2)
function arg(name, def) {
  const i = args.indexOf('--' + name)
  return i !== -1 ? args[i + 1] : def
}
const url = arg('url', 'http://localhost:3000')
const type = arg('type', 'static')
const total = parseInt(arg('n', '100'), 10)
const conc = parseInt(arg('c', '10'), 10)
const msg = arg('msg', 'ahri cầm gì')

console.log(`Load test: ${type} × ${total} yêu cầu, ${conc} chạy đồng thời → ${url}`)

const latencies = []      // ms toàn bộ yêu cầu
const ttfd = []           // ms tới byte đầu tiên (chỉ stream)
const codes = new Map()   // đếm mã trạng thái
let errors = 0

async function one() {
  const started = performance.now()
  try {
    if (type === 'chat') {
      const res = await fetch(url + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: [] }),
      })
      await res.text()
      record(started, res.status)
    } else if (type === 'chat-stream') {
      const res = await fetch(url + '/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: [] }),
      })
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let firstByteAt = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!firstByteAt && value.length) {
          firstByteAt = performance.now()
          ttfd.push(firstByteAt - started)
        }
        dec.decode(value, { stream: true })
      }
      record(started, res.status)
    } else {
      const res = await fetch(url + (type === 'health' ? '/api/health' : '/'))
      await res.arrayBuffer()
      record(started, res.status)
    }
  } catch (e) {
    errors++
    latencies.push(performance.now() - started)
  }
}

function record(started, status) {
  latencies.push(performance.now() - started)
  codes.set(status, (codes.get(status) || 0) + 1)
}

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))]
}

async function run() {
  const t0 = performance.now()
  let done = 0
  // chạy theo lô: mỗi lô `conc` yêu cầu song song, xong lô mới chạy lô kế
  while (done < total) {
    const batch = Math.min(conc, total - done)
    await Promise.all(Array.from({ length: batch }, one))
    done += batch
    process.stdout.write(`\r  tiến độ: ${done}/${total}`)
  }
  const wall = (performance.now() - t0) / 1000

  const ok = latencies.length - errors
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)
  console.log(`\n\n===== KẾT QUẢ =====`)
  console.log(`Thời gian tổng   : ${wall.toFixed(2)}s  (~${(total / wall).toFixed(1)} yêu cầu/giây)`)
  console.log(`Thành công       : ${ok}  |  Lỗi mạng: ${errors}`)
  console.log(`Mã trạng thái    : ${[...codes.entries()].map(([k, v]) => `${k}×${v}`).join('  ') || 'không có'}`)
  if (latencies.length) {
    console.log(`Độ trễ (ms)      : tb=${avg.toFixed(0)} | 50%=${pct(latencies, 50).toFixed(0)} | 95%=${pct(latencies, 95).toFixed(0)} | chậm nhất=${Math.max(...latencies).toFixed(0)}`)
  }
  if (ttfd.length) {
    console.log(`Chữ đầu tiên (ms): tb=${(ttfd.reduce((a, b) => a + b, 0) / ttfd.length).toFixed(0)} | 95%=${pct(ttfd, 95).toFixed(0)} | chậm nhất=${Math.max(...ttfd).toFixed(0)}`)
  }
  const r429 = codes.get(429) || 0
  if (r429) console.log(`⚠️  ${r429} yêu cầu bị chặn 429 — rate limit hoạt động đúng (hoặc hết hạn mức Gemini)`)
}

run()
