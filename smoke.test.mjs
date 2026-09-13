import fs from 'node:fs'

const BASE = 'http://localhost:8787'
async function post(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function chat(message, history = []) {
  // Lớp 2: embed + search
  const s = await post('/api/embed', { text: message })
  if (s.status !== 200) return { error: s.json.error || 'embed fail', answer: '' }
  const vector = s.json.vector
  const store = JSON.parse(fs.readFileSync('public/data/rag_store.json', 'utf8'))
  const tokens = new Set(message.toLowerCase().split(/\s+/).filter(t => t.length >= 3))
  const hits = store.chunks
    .map(c => {
      let dot = 0, na = 0, nb = 0
      for (let i = 0; i < Math.min(vector.length, c.vector.length); i++) { dot += vector[i] * c.vector[i]; na += vector[i] ** 2; nb += c.vector[i] ** 2 }
      const cos = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
      let kw = 0
      const lower = c.text.toLowerCase()
      for (const tk of tokens) if (lower.includes(tk)) kw += 0.03
      return { text: c.text, score: cos + kw }
    })
    .sort((a, b) => b.score - a.score).slice(0, 4)
  const context = hits.map(h => h.text).join('\n---\n')
  // Lớp 3: stream
  const res = await fetch(BASE + '/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context, history }),
  })
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
  return { error: null, answer: full, chunks: hits }
}

console.log('=== T1: gõ sai tên tướng ===')
let r = await chat('casopia cầm gì')
console.log(r.answer.slice(0, 150))
console.log(r.answer.toLowerCase().includes('cassiopeia') ? '✅ OK' : '❌ SAI')

console.log('\n=== T2: đội hình mạnh nhất ===')
r = await chat('meta hiện tại đội hình nào mạnh nhất')
console.log(r.answer.slice(0, 150))
console.log(r.answer.toLowerCase().includes('avg') || /\d\.\d/.test(r.answer) ? '✅ OK (có số liệu)' : '❌ SAI')

console.log('\n=== T3: teencode nặng (kịch bản 19) ===')
r = await chat('choy hẹ nao dẽ choy nắc dza')
console.log(r.answer.slice(0, 150))
console.log(/hệ|trait|tộc/i.test(r.answer) ? '✅ OK (hiểu teencode)' : '⚠️ xem lại')

console.log('\n=== T4: guardrail lạc đề ===')
r = await chat('hôm nay ăn cơm với gì ngon')
console.log(r.answer.slice(0, 120))
console.log(/đấu trường|tft|coach/i.test(r.answer) && !/cơm.*ngon.*[123]/i.test(r.answer) ? '✅ OK (lật về game)' : '⚠️ xem lại')
