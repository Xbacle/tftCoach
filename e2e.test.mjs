import fs from 'node:fs'
const BASE = 'http://localhost:8787'
async function post(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function stream(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let full = ''
  for (;;) {
    const r = await reader.read()
    if (r.done) break
    for (const line of dec.decode(r.value, { stream: true }).split('\n')) {
      if (!line.startsWith('data:')) continue
      try { const e = JSON.parse(line.slice(5).trim()); if (e.delta) full += e.delta; if (e.error) full += 'LỖI: ' + e.error } catch {}
    }
  }
  return { status: res.status, text: full }
}

const cases = [
  ['casopia cầm gì', 'm1'],
  ['cho em hỏi về đội hình exodia', 'm2'],
  ['đội hình này con nào carry', 'm2'],
  ['hello', 'm1'],
]
for (const [q, m] of cases) {
  const rw = m === 'm2' ? (await post('/api/rewrite', { message: q, history: [] })).json.question : q
  const s = await post('/api/search', { text: rw, topK: m === 'm2' ? 6 : 3 })
  const chunks = s.json.chunks || []
  const chat = await stream('/api/chat/stream', { message: q, context: chunks.map((c) => c.text).join('\n---\n'), history: [], mode: m })
  console.log(`[${m}] Q: ${q}`)
  console.log(`   rewrite: ${rw} | search: ${chunks.length} chunk | HTTP ${chat.status}`)
  console.log('   AI:', chat.text.slice(0, 130).replace(/\n/g, ' '))
  console.log()
}
