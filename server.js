import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chatWithGemini, streamChatGemini, embedText, rewriteQuery } from './server/chatCore.js'
import { checkRateLimit } from './server/rateLimit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile(fileName) {
  const file = path.join(__dirname, fileName)
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')
const distDir = path.join(__dirname, 'dist')

// RAG v4: nạp kho vector 1 lần lúc khởi động (tìm kiếm chạy server-side)
const { searchChunks } = await import('./src/ai/search.js')
const RAG_PATH = path.join(__dirname, 'public/data/rag_store.json')
const ragStore = fs.existsSync(RAG_PATH) ? JSON.parse(fs.readFileSync(RAG_PATH, 'utf8')) : null
console.log(`RAG store: ${ragStore ? ragStore.chunks.length + ' chunks' : 'KHÔNG TÌM THẤY — chat sẽ không có dữ liệu truy xuất'}`)
// Cờ --dev phải thắng PORT trong .env: chế độ dev luôn dùng 8787 (tránh đụng cổng 3000 của bản production)
const isDev = process.argv.includes('--dev')
const port = Number(isDev ? 8787 : (process.env.PORT || 3000))

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 2_000_000) req.destroy()
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

function contentType(file) {
  const ext = path.extname(file)
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream'
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '')
  const candidate = path.resolve(distDir, clean)
  return candidate.startsWith(path.resolve(distDir)) ? candidate : null
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/chat') {
      const key = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local'
      const limit = checkRateLimit(String(key).split(',')[0].trim())
      if (!limit.allowed) return sendJson(res, 429, { error: 'Đang có quá nhiều yêu cầu. Hãy thử lại sau một phút.' })
      const body = await readBody(req)
      const message = String(body.message || '').trim()
      if (!message) return sendJson(res, 400, { error: 'Tin nhắn trống.' })
      const result = await chatWithGemini({ message, context: String(body.context || '').slice(0, 7000), analysis: body.analysis || null, history: Array.isArray(body.history) ? body.history.slice(-6) : [] })
      return sendJson(res, 200, result)
    }

    if (req.method === 'POST' && req.url === '/api/chat/stream') {
      const key = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local'
      const limit = checkRateLimit(String(key).split(',')[0].trim())
      if (!limit.allowed) return sendJson(res, 429, { error: 'Đang có quá nhiều yêu cầu. Hãy thử lại sau một phút.' })
      const body = await readBody(req)
      const message = String(body.message || '').trim()
      if (!message) return sendJson(res, 400, { error: 'Tin nhắn trống.' })

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const sendEvent = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
      // req.signal của Node abort ngay sau khi đọc xong body — không dùng được cho fetch upstream.
      // Chỉ abort khi client thật sự ngắt kết nối giữa chừng.
      const upstream = new AbortController()
      res.on('close', () => { if (!res.writableEnded) upstream.abort() })
      try {
        const result = await streamChatGemini({
          message,
          context: String(body.context || '').slice(0, 7000),
          analysis: body.analysis || null,
          history: Array.isArray(body.history) ? body.history.slice(-6) : [],
          signal: upstream.signal,
          onDelta: (delta) => sendEvent({ delta }),
        })
        sendEvent({ done: true, model: result.model })
      } catch (error) {
        if (!upstream.signal.aborted) sendEvent({ error: error?.message || 'AI server error', status: error?.status || 500 })
      }
      return res.end()
    }

    if (req.method === 'POST' && req.url === '/api/search') {
      const key = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local'
      const limit = checkRateLimit(String(key).split(',')[0].trim())
      if (!limit.allowed) return sendJson(res, 429, { error: 'Đang có quá nhiều yêu cầu. Hãy thử lại sau một phút.' })
      const body = await readBody(req)
      const text = String(body.text || '').trim()
      const topK = Math.min(Number(body.topK) || 3, 8)
      if (!text) return sendJson(res, 400, { error: 'Thiếu nội dung.' })
      if (!ragStore) return sendJson(res, 500, { error: 'Server chưa có rag_store.json' })
      const vector = await embedText(text)
      const hits = searchChunks(ragStore, vector, text, topK)
      return sendJson(res, 200, { chunks: hits.map((h) => ({ text: h.text, type: h.type, id: h.id, score: Number(h.score.toFixed(4)) })) })
    }

    if (req.method === 'POST' && req.url === '/api/embed') {
      const body = await readBody(req)
      const text = String(body.text || '').trim()
      if (!text) return sendJson(res, 400, { error: 'Thiếu nội dung.' })
      const vector = await embedText(text)
      return sendJson(res, 200, { vector })
    }

    if (req.method === 'POST' && req.url === '/api/rewrite') {
      const body = await readBody(req)
      const message = String(body.message || '').trim()
      if (!message) return sendJson(res, 400, { error: 'Thiếu tin nhắn.' })
      const question = await rewriteQuery({ message, history: Array.isArray(body.history) ? body.history.slice(-2) : [] })
      return sendJson(res, 200, { question })
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
        hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      })
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' })

    let file = safePath(req.url || '/')
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'Build not found. Run npm run build first.' })

    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file).pipe(res)
  } catch (error) {
    sendJson(res, 500, { error: error?.message || 'Server error' })
  }
})

server.listen(port, () => console.log(`TFT Helper server running at http://localhost:${port}`))
