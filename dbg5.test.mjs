import { analyzeQuery } from './src/ai/analyzer.js'
import { retrieveContext, directAnswer } from './src/ai/retriever.js'
import fs from 'node:fs'

const data = {
  set18: JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8')),
  comps: JSON.parse(fs.readFileSync('public/data/comps.json', 'utf8')),
  processed: JSON.parse(fs.readFileSync('public/data/items_processed.json', 'utf8')),
  assets: {}, glossary: JSON.parse(fs.readFileSync('public/data/glossary.json', 'utf8')),
}

console.log('--- L1: "chi tiết fast 9 đi" (sau khi exodia đã liệt kê) ---')
let a = analyzeQuery(data, 'chi tiết fast 9 đi', [], {})
console.log('intent:', a.intent, '| compFilter:', JSON.stringify(a.compFilter))
let c = retrieveContext(data, a)
let d = directAnswer(data, a, c)
console.log(d ? d.split('\n').slice(0, 3).join('\n') : '(null → Gemini)')

console.log('\n--- L2: "Elder Dragon Carry" ---')
let a2 = analyzeQuery(data, 'Elder Dragon Carry', [], {})
let c2 = retrieveContext(data, a2)
let d2 = directAnswer(data, a2, c2)
console.log(d2 ? d2.split('\n').slice(0, 3).join('\n') : '(null → Gemini)')

console.log('\n--- L3: "defender core" ---')
let a3 = analyzeQuery(data, 'defender core', [], {})
let d3 = directAnswer(data, a3, retrieveContext(data, a3))
console.log(d3 ? d3.split('\n').slice(0, 2).join('\n') : '(null → Gemini)')

console.log('\n--- L4: hồi quy "ahri cầm gì" không bị rule chặn ---')
let a4 = analyzeQuery(data, 'ahri cầm gì', [], {})
console.log('L4:', directAnswer(data, a4, retrieveContext(data, a4)) || 'null')
