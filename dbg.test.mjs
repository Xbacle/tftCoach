import { analyzeQuery } from './src/ai/analyzer.js'
import { retrieveContext, directAnswer } from './src/ai/retriever.js'
import { updateMemory, mergeMemory } from './src/ai/memory.js'
import fs from 'node:fs'

const data = {
  set18: JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8')),
  comps: JSON.parse(fs.readFileSync('public/data/comps.json', 'utf8')),
  processed: JSON.parse(fs.readFileSync('public/data/items_processed.json', 'utf8')),
  assets: JSON.parse(fs.readFileSync('public/data/assets.json', 'utf8')),
}

console.log('--- T3 debug ---')
let a3 = analyzeQuery(data, 'đội hình Defender Core chơi thế nào', [], {})
console.log('a3 intent:', a3.intent, '| units:', a3.entities.units.map(u => u.apiName), '| traits:', a3.entities.traits.map(u => u.apiName))
let ctx3 = retrieveContext(data, a3)
console.log('ctx3 chunks:', ctx3.chunks.map(c => c.type + ':' + (c.name || c.carry || '?')).slice(0, 6))
let mem = updateMemory(a3, ctx3)
console.log('memory:', JSON.stringify(mem))
let a4raw = analyzeQuery(data, 'nó cầm gì', [], {})
console.log('a4raw intent:', a4raw.intent, '| mentionsTft:', a4raw.mentionsTft, '| normalized:', a4raw.normalized)
let a4 = mergeMemory(a4raw, mem)
console.log('a4 units:', a4.entities.units.map(u => u.apiName), '| intent:', a4.intent)

console.log('\n--- T5 debug ---')
let a6 = analyzeQuery(data, 'warmog ghép từ gì', [], {})
console.log('a6 intent:', a6.intent, '| items:', a6.entities.items.map(x => ({ api: x.apiName, s: Math.round(x.score * 100) / 100 })))
const pit = (data.processed && data.processed.itemNames) || {}
const hit = Object.entries(pit).filter(([k, e]) => e && /warmog/i.test((e.name || '') + k)).slice(0, 2)
console.log('processed warmog entries:', hit.map(([k, e]) => ({ k, name: e.name, comp: e.composition, keys: Object.keys(e) })))
