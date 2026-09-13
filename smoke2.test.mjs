import { analyzeQuery } from './src/ai/analyzer.js'
import { retrieveContext, directAnswer } from './src/ai/retriever.js'
import { updateMemory, mergeMemory } from './src/ai/memory.js'
import fs from 'node:fs'

const data = {
  set18: JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8')),
  comps: JSON.parse(fs.readFileSync('public/data/comps.json', 'utf8')),
  processed: JSON.parse(fs.readFileSync('public/data/items_processed.json', 'utf8')),
  assets: JSON.parse(fs.readFileSync('public/data/assets.json', 'utf8')),
  glossary: JSON.parse(fs.readFileSync('public/data/glossary.json', 'utf8')),
}

console.log('=== N1: gõ sai "casopia" → ra Cassiopeia ===')
let a1 = analyzeQuery(data, 'casopia', [], {})
console.log('tướng:', a1.entities.units[0] ? a1.entities.units[0].apiName : 'THẤT BẠI', '| mentionsTft:', a1.mentionsTft)
let c1 = retrieveContext(data, a1)
let d1 = directAnswer(data, a1, c1)
console.log('trả lời:', d1 ? d1.split('\n')[0] : '(null → Gemini)')
const got = d1 && /cassiopeia/i.test(d1) && /đội hình/i.test(d1)
console.log(got || c1.chunks.some(c => c.type === 'unit' && /cassiopeia/i.test(c.name || '')) ? 'OK' : 'SAI')

console.log('\n=== N2: follow-up "đội này con nào carry" sau khi nói về comp ===')
let a2 = analyzeQuery(data, 'cho xem đội hình Vanguard Ahri', [], {})
let c2 = retrieveContext(data, a2)
let mem2 = updateMemory(a2, c2)
console.log('memory.comp:', JSON.stringify(mem2.comp))
let a3raw = analyzeQuery(data, 'đội hình này con nào carry', [], {})
let a3 = mergeMemory(a3raw, mem2)
console.log('merged intent:', a3.intent, '| units:', a3.entities.units.map(u => u.apiName).join(','), '| comp:', a3.comp ? a3.comp.name : null)
let d3 = directAnswer(data, a3, c2, mem2)
console.log('trả lời:', d3 || '(null)')
console.log('carry khớp memory:', d3 && d3.includes(mem2.comp.carryName) ? 'OK' : 'SAI')

console.log('\n=== N3: "gợi ý đội hình reroll" → comp có tên thân thiện + style ===')
let a4 = analyzeQuery(data, 'gợi ý đội hình reroll', [], {})
let c4 = retrieveContext(data, a4)
const comp4 = c4.chunks.find(c => c.type === 'comp')
console.log('tên:', comp4.name, '| style:', comp4.style, '| carryName:', comp4.carryName)
console.log(/reroll/i.test(comp4.name + comp4.style) && comp4.carryName ? 'OK' : 'SAI')
