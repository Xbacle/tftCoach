import { analyzeQuery } from './src/ai/analyzer.js'
import { retrieveContext, directAnswer } from './src/ai/retriever.js'
import { createTftRepository } from './src/services/tftRepository.js'
import { normalizeText } from './src/ai/text.js'
import fs from 'node:fs'

const data = {
  set18: JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8')),
  comps: JSON.parse(fs.readFileSync('public/data/comps.json', 'utf8')),
  processed: JSON.parse(fs.readFileSync('public/data/items_processed.json', 'utf8')),
  assets: {},
}
const repo = createTftRepository(data)
let a6 = analyzeQuery(data, 'warmog ghép từ gì', [], {})
let ctx6 = retrieveContext(data, a6)
const n = a6.normalized
console.log('n:', JSON.stringify(n), '| intent:', a6.intent)

const tokens = new Set(n.split(/\s+/))
let best = null, bestScore = -1
for (const x of a6.entities.items || []) {
  const it = repo.getItem(x.apiName) || repo.getItem(x.name)
  if (!it) { console.log('  skip (không tìm thấy):', x.apiName); continue }
  const nameNorm = normalizeText(it.name)
  let overlap = 0
  for (const tk of tokens) if (tk.length >= 3 && nameNorm.includes(tk)) overlap += 1
  const sc = overlap * 10 - (x.score || 0)
  console.log('  cand:', x.apiName, '| name:', it.name, '| overlap:', overlap, '| sc:', sc)
  if (sc > bestScore) { bestScore = sc; best = it }
}
console.log('best item:', best ? best.name : 'NULL')
const comps = best ? repo.getComponentsForItem(best).filter(Boolean) : []
console.log('composition:', comps.map(c => c.name))
const r = directAnswer(data, a6, ctx6)
console.log('directAnswer:', r ? r.slice(0, 120) : 'NULL')
