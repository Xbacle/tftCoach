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

console.log('=== T1: đội hình mạnh nhất — avg tăng dần ===')
let a = analyzeQuery(data, 'meta hiện tại đội hình nào mạnh nhất', [], {})
let ctx = retrieveContext(data, a)
const top = ctx.chunks[0]
const avgs = ctx.chunks.map(c => c.overall && c.overall.avg)
console.log('comp đầu:', top.name, '| avg:', top.overall.avg, '| carry:', top.carry)
console.log('thứ tự đúng?', JSON.stringify(avgs) === JSON.stringify([...avgs].sort((x,y)=>x-y)) ? 'OK' : 'SAI ' + JSON.stringify(avgs))

console.log('\n=== T2: hỏi lại lần 2 → context GIỐNG HỆT ===')
let a2 = analyzeQuery(data, 'meta hiện tại đội hình nào mạnh nhất', [], {})
let ctx2 = retrieveContext(data, a2)
console.log(JSON.stringify(ctx) === JSON.stringify(ctx2) ? 'OK — nhất quán' : 'SAI')

console.log('\n=== T3: follow-up "nó cầm gì" ===')
let a3 = analyzeQuery(data, 'đội hình Defender Core chơi thế nào', [], {})
let ctx3 = retrieveContext(data, a3)
let mem = updateMemory(a3, ctx3)
let a4 = mergeMemory(analyzeQuery(data, 'nó cầm gì', [], {}), mem)
console.log('nhớ carry:', a4.entities.units.map(u => u.apiName).join(',') || 'KHÔNG NHỚ')
let ctx4 = retrieveContext(data, a4)
console.log('chunks có tướng:', ctx4.chunks.some(c => c.type === 'unit') ? 'OK' : 'THIẾU')

console.log('\n=== T4: alias teencode ===')
let a5 = analyzeQuery(data, 'ahrii cầm bb được không', [], {})
console.log('tướng:', a5.entities.units[0] ? a5.entities.units[0].apiName : '?', '| item:', a5.entities.items.map(x => x.apiName).slice(0,2).join(',') || '?')

console.log('\n=== T5: direct answer — đồ ghép ===')
let a6 = analyzeQuery(data, 'warmog ghép từ gì', [], {})
let ctx6 = retrieveContext(data, a6)
console.log(directAnswer(data, a6, ctx6) || '(null → Gemini)')
