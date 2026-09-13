// ============================================================
// LỚP 1 — DATA PIPELINE (RAG v4)
// Chunking 4 tệp JSON → embedding Gemini → public/data/rag_store.json
// RESUMABLE: chạy lại nhiều lần vẫn tiếp tục từ chỗ dừng.
// Chạy:  npx tsx scripts/build-rag.mjs
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createTftRepository } from '../src/services/tftRepository.js'
import { getCompIdentity } from '../src/utils/compNaming.js'

const ROOT = path.join(import.meta.dirname, '..')
const STORE_PATH = path.join(ROOT, 'public/data/rag_store.json')
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta'
const EMBED_MODEL = 'models/gemini-embedding-2'
const DIM = 1536

function apiKey() {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')
  const line = env.split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY='))
  return line ? line.slice('GEMINI_API_KEY='.length).trim() : null
}
const KEY = apiKey()
if (!KEY) { console.error('Thiếu GEMINI_API_KEY trong .env.local'); process.exit(1) }

const data = {
  set18: JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/Set18.json'), 'utf8')),
  comps: JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/comps.json'), 'utf8')),
  processed: JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/items_processed.json'), 'utf8')),
  assets: {},
}
const repo = createTftRepository(data)

// ---- chunking ----
const chunks = []
const add = (id, type, text) => chunks.push({ id, type, text })
const itemName = (x) => { const it = repo.getItem(x); return it ? it.name : null }

for (const u of repo.getUnits()) {
  const stats = repo.getUnitStats(u)
  const perf = (stats && Array.isArray(stats.items) ? stats.items : []).slice(0, 3)
    .map((x) => itemName(x.itemName || x.apiName)).filter(Boolean)
  add('unit:' + u.apiName, 'unit',
    `Tướng ${u.name} (${u.en_name || ''}) — ${u.cost} vàng. Tộc/hệ: ${(u.traits || []).join(', ')}. Vai trò: ${u.role || 'chưa rõ'}.`
    + (perf.length ? ` Đồ thường dùng: ${perf.join(', ')}.` : '')
    + (stats ? ` Độ phổ biến: ${(stats.pick * 100).toFixed(1)}% trận, avg place ${Number(stats.avg).toFixed(2)} trên ${Number(stats.count).toLocaleString('vi-VN')} trận.` : ''))
}

for (const comp of repo.getComps()) {
  const idn = getCompIdentity(comp, repo)
  const units = repo.getCompUnits(comp).map((u) => u.name)
  const items = (comp.top_itemNames || []).slice(0, 4).map(itemName).filter(Boolean)
  const traits = repo.getCompTraitActivations(comp).filter((a) => a.isActive)
    .map((a) => `${a.count != null ? a.count + ' ' : ''}${a.trait.name}`)
  const avg = comp.overall && comp.overall.avg != null ? comp.overall.avg : '?'
  const count = comp.overall && comp.overall.count != null ? Number(comp.overall.count).toLocaleString('vi-VN') : '?'
  add('comp:' + comp.Cluster, 'comp',
    `Đội hình ${idn.title} (${idn.style || 'Flex'}) — carry ${idn.carry ? idn.carry.name : '?'}`
    + `, frontline ${idn.tank ? idn.tank.name : '?'}. Tướng: ${units.slice(0, 8).join(', ')}.`
    + (items.length ? ` Đồ lõi: ${items.join(', ')}.` : '')
    + ` Tộc/hệ kích hoạt: ${traits.slice(0, 5).join(', ')}.`
    + ` Avg place ${avg} trên ${count} trận.`)
}

for (const it of repo.getItems()) {
  const comps = repo.getComponentsForItem(it).map((c) => c.name)
  add('item:' + it.apiName, 'item',
    `Trang bị ${it.name} — ${it.statLine || ''}. ${it.desc ? String(it.desc).slice(0, 160) : ''}`
    + (comps.length ? ` Ghép từ: ${comps.join(' + ')}.` : ''))
}

for (const t of repo.getTraits()) {
  const effects = (t.effects || []).slice(0, 5)
    .map((e) => `${e.count ?? e.min ?? e.threshold ?? '?'}: ${String(e.desc ?? e.description ?? '').slice(0, 90)}`)
  add('trait:' + t.apiName, 'trait',
    `Tộc/hệ ${t.name} — ${t.desc ? String(t.desc).slice(0, 150) : ''}`
    + (effects.length ? ` Mốc kích hoạt — ${effects.join(' | ')}.` : ''))
}

for (const a of repo.getAugments()) {
  add('augment:' + a.apiName, 'augment',
    `Augment ${a.name} (${a.rarity || '?'}): ${String(a.desc || a.description || '').slice(0, 180)}`)
}

for (const c of data.set18.charms || []) {
  if (!c.name) continue
  add('charm:' + c.apiName, 'charm', `Bùa ${c.name} (${c.cost != null ? c.cost + ' vàng' : '?'}): ${String(c.desc || '').slice(0, 140)}`)
}
for (const e of data.set18.encounters || []) {
  if (!e.name) continue
  add('encounter:' + e.apiName, 'encounter', `Gặp gỡ ${e.name}: ${String(e.desc || '').slice(0, 160)}`)
}

// ---- Gắn thuật ngữ cộng đồng (từ glossary.json) vào chunk text ----
// Đây là cơ chế "train": thêm 1 mục vào glossary.json -> chạy lại script -> AI nhận diện được thuật ngữ mới.
try {
  const gl = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/glossary.json'), 'utf8'))
  for (const term of gl.communityTerms || []) {
    const cf = term.compFilter || {}
    if (cf.kind === 'expensive') {
      // gắn nhãn cho 3 đội tổng vàng cao nhất
      const ranked = [...repo.getComps()].sort((a, b) => {
        const g = (x) => (x.units_string || '').split(',').reduce((t, id) => { const u = repo.getUnit(id.trim()); return t + (u ? Number(u.cost) || 0 : 0) }, 0)
        return g(b) - g(a)
      }).slice(0, 3)
      for (const c of ranked) {
        const ch = chunks.find((x) => x.id === 'comp:' + c.Cluster)
        if (ch && !ch.text.includes(term.pattern)) ch.text += ` (cộng đồng gọi là đội hình ${term.pattern}.)`
      }
    }
    if (cf.kind === 'levelling') {
      const m = String(cf.match || '').toLowerCase()
      for (const c of chunks) {
        if (c.type === 'comp' && (c.text.includes('Level ' + m) || (c.text.match(new RegExp('\(' + m, 'i')))) && !c.text.includes(term.pattern)) {
          c.text += ` (cộng đồng gọi là ${term.pattern}.)`
        }
      }
    }
  }
  console.log('Đã gắn thuật ngữ cộng đồng từ glossary vào chunk')
} catch (e) { console.log('glossary skip:', e.message) }

// ---- RESUMABLE store ----
const store = fs.existsSync(STORE_PATH)
  ? JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
  : { model: EMBED_MODEL, dim: DIM, chunks: [] }
const oldById = new Map(store.chunks.map((c) => [c.id, c]))
const pending = chunks.filter((c) => {
  const old = oldById.get(c.id)
  return !old || old.text !== c.text
})

console.log(`Tổng ${chunks.length} chunk — cần embed: ${pending.length} (đã có ${store.chunks.length} trong store)`)
if (!pending.length) { console.log('✅ Hoàn tất từ trước.'); process.exit(0) }

// ---- embed 1 chunk (retry 429 chờ 30s, quá 5 lần trả null) ----
async function embedOne(text) {
  const body = JSON.stringify({
    model: EMBED_MODEL,
    content: { parts: [{ text }] },
    outputDimensionality: 1536,
  })
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${API_ROOT}/${EMBED_MODEL}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body,
    })
    if (res.ok) {
      const json = await res.json()
      return json.embedding.values
    }
    console.log(`  embed ${res.status} (lần ${attempt}/5) — chờ 30s`)
    await new Promise((r) => setTimeout(r, 30000))
  }
  return null
}

// ---- 1 worker tuần tự + lưu tiến trình mỗi 20 chunk ----
let done = 0
let stopped = false
async function worker() {
  for (const c of pending) {
    if (stopped) return
    const vector = await embedOne(c.text)
    if (vector === null) { stopped = true; console.log('⚠️ Dừng mềm — chạy lại script để tiếp tục.'); return }
    const oldIdx = store.chunks.findIndex((x) => x.id === c.id)
    if (oldIdx !== -1) store.chunks[oldIdx] = { id: c.id, type: c.type, text: c.text, vector }
    else store.chunks.push({ id: c.id, type: c.type, text: c.text, vector })
    done++
    if (done % 20 === 0) {
      fs.writeFileSync(STORE_PATH, JSON.stringify(store))
      console.log(`  tiến trình: ${store.chunks.length}/${chunks.length} đã lưu`)
    }
  }
}
await worker()

fs.writeFileSync(STORE_PATH, JSON.stringify(store))
console.log(`✅ Lần chạy này embed ${done} chunk — store hiện ${store.chunks.length}/${chunks.length}`)
if (store.chunks.length >= chunks.length) console.log('🎉 HOÀN TẤT TOÀN BỘ EMBEDDING')
