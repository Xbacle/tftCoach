import { searchChunks } from './src/ai/search.js'
import fs from 'node:fs'

const data = {
  set18: JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8')),
  comps: JSON.parse(fs.readFileSync('public/data/comps.json', 'utf8')),
  processed: JSON.parse(fs.readFileSync('public/data/items_processed.json', 'utf8')),
  assets: {},
  glossary: JSON.parse(fs.readFileSync('public/data/glossary.json', 'utf8')),
}
const env = fs.readFileSync('.env.local', 'utf8')
const key = env.split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY=')).slice('GEMINI_API_KEY='.length).trim()

async function embed(text) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ model: 'models/gemini-embedding-2', content: { parts: [{ text }] }, outputDimensionality: 1536 }),
  })
  if (!res.ok) throw new Error('embed ' + res.status)
  return (await res.json()).embedding.values
}

const queries = ['casopia cầm gì', 'exodia', 'tộc fae mốc kích hoạt', 'đội hình reroll mạnh nhất']
for (const q of queries) {
  const vector = await embed(q)
  const hits = searchChunks({ chunks: [] }, vector, q, 3) // placeholder — cần store thật
  console.log('Q:', q)
  for (const h of hits) console.log('   →', h.type + ':', h.text.slice(0, 70))
  console.log()
}
const store = JSON.parse(fs.readFileSync('public/data/rag_store.json', 'utf8'))
console.log('store chunks:', store.chunks.length)
for (const q of queries) {
  const vector = await embed(q)
  const hits = searchChunks(store, vector, q, 2)
  console.log('Q:', q)
  hits.forEach(h => console.log('   →', h.type + ':', h.text.slice(0, 70)))
}
