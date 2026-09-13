import { analyzeQuery } from './src/ai/analyzer.js'
import { retrieveContext, directAnswer } from './src/ai/retriever.js'
import fs from 'node:fs'

const data = {
  set18: JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8')),
  comps: JSON.parse(fs.readFileSync('public/data/comps.json', 'utf8')),
  processed: JSON.parse(fs.readFileSync('public/data/items_processed.json', 'utf8')),
  assets: {},
  glossary: JSON.parse(fs.readFileSync('public/data/glossary.json', 'utf8')),
}
let r1 = analyzeQuery(data, 'gợi ý đội hình reroll', [], {})
console.log('r1.intent:', r1.intent, '| r1.compFilter:', JSON.stringify(r1.compFilter))
let c1 = retrieveContext(data, r1)
console.log('c1.chunks:', c1 ? c1.chunks.map(c => c.type + ':' + (c.name || '?') + '|lvl=' + (c.levelling || '?')).slice(0, 5) : 'NULL')
let d1 = directAnswer(data, r1, c1)
console.log('d1:', d1 ? d1.split('\n').slice(0, 3).join(' | ') : 'NULL')
