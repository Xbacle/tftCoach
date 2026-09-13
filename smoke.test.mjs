import { analyzeQuery } from './src/ai/analyzer.js'
import { retrieveContext, directAnswer } from './src/ai/retriever.js'
import { updateMemory, mergeMemory } from './src/ai/memory.js'
import { createTftRepository } from './src/services/tftRepository.js'
import fs from 'node:fs'

const data = {
  set18: JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8')),
  comps: JSON.parse(fs.readFileSync('public/data/comps.json', 'utf8')),
  processed: JSON.parse(fs.readFileSync('public/data/items_processed.json', 'utf8')),
  assets: JSON.parse(fs.readFileSync('public/data/assets.json', 'utf8')),
  glossary: JSON.parse(fs.readFileSync('public/data/glossary.json', 'utf8')),
}
const repo = createTftRepository(data)
const goldOf = (id) => {
  const comp = repo.getComp(id)
  return (comp.units_string || '').split(',').reduce((s, x) => {
    const u = repo.getUnit(x.trim())
    return s + (u ? u.cost : 0)
  }, 0)
}

console.log('=== T1: đội hình mạnh nhất — avg tăng dần ===')
let a = analyzeQuery(data, 'meta hiện tại đội hình nào mạnh nhất', [], {})
let ctx = retrieveContext(data, a)
const top = ctx.chunks[0]
const avgs = ctx.chunks.map(c => c.overall && c.overall.avg)
console.log('comp đầu:', top.name, '| avg:', top.overall.avg, '| carry:', top.carryName || top.carry)
console.log('thứ tự đúng?', JSON.stringify(avgs) === JSON.stringify([...avgs].sort((x, y) => x - y)) ? 'OK' : 'SAI ' + JSON.stringify(avgs))

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
console.log('tướng:', a5.entities.units[0] ? a5.entities.units[0].apiName : '?', '| item:', a5.entities.items.map(x => x.apiName).slice(0, 2).join(',') || '?')

console.log('\n=== T5: direct answer — đồ ghép ===')
let a6 = analyzeQuery(data, 'warmog ghép từ gì', [], {})
let ctx6 = retrieveContext(data, a6)
console.log(directAnswer(data, a6, ctx6) || '(null → Gemini)')

console.log('\n=== T6: hỏi reroll 2 lần → GIỐNG HỆT + lọc đúng ===')
let b1 = analyzeQuery(data, 'gợi ý đội hình reroll', [], {})
let e1 = retrieveContext(data, b1)
let x1 = directAnswer(data, b1, e1)
let b2 = analyzeQuery(data, 'gợi ý đội hình reroll', [], {})
let e2 = retrieveContext(data, b2)
let x2 = directAnswer(data, b2, e2)
console.log('2 lần giống hệt:', x1 && x1 === x2 ? 'OK' : 'SAI')
console.log('lọc levelling lvl:', e1.chunks.filter(c => c.type === 'comp').every(c => /lvl/i.test(c.levelling || '')) ? 'OK' : 'SAI')
console.log(x1 ? x1.split('\n')[0] : '(null → Gemini)')

console.log('\n=== T7: exodia → đội nhiều vàng nhất đứng đầu ===')
let b3 = analyzeQuery(data, 'cho em hỏi về đội hình exodia', [], {})
let e3 = retrieveContext(data, b3)
let x3 = directAnswer(data, b3, e3)
console.log('compFilter:', JSON.stringify(b3.compFilter), '| explain:', b3.communityExplain ? 'OK' : 'THIẾU')
const golds = e3.chunks.filter(c => c.type === 'comp').map(c => goldOf(c.id))
console.log('thứ tự vàng giảm dần:', golds.every((v, i, arr) => i === 0 || arr[i - 1] >= v) ? 'OK' : 'SAI', JSON.stringify(golds))
console.log(x3 ? x3.split('\n')[0] : '(null → Gemini)')

console.log('\n=== T8: thuật ngữ MỚI thêm vào glossary được nhận diện ===')
const data2 = { ...data, glossary: { ...data.glossary, communityTerms: [
  ...(data.glossary?.communityTerms || []),
  { pattern: 'hyper roll', compFilter: { kind: 'levelling', match: 'Fast' }, explain: 'Hyper roll = lên cấp nhanh' },
] } }
let a8 = analyzeQuery(data2, 'hyper roll chơi gì giờ', [], {})
console.log('nhận diện:', a8.compFilter ? JSON.stringify(a8.compFilter) : 'THẤT BẠI', '| explain:', a8.communityExplain || 'THIẾU')
let c8 = retrieveContext(data2, a8)
console.log('chunks lọc Fast:', c8 && c8.chunks.filter(c => c.type === 'comp').every(c => /fast/i.test(c.levelling || '')) ? 'OK' : 'SAI')
