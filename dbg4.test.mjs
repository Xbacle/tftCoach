import Fuse from 'fuse.js'
const set18 = JSON.parse(fs.readFileSync('public/data/Set18.json', 'utf8'))
function fs2(p) { return fs.readFileSync(p, 'utf8') }
import fs from 'node:fs'
const units = set18.units.filter(u => u.shopUnit === true)
const fuse = new Fuse(units, { includeScore: true, ignoreLocation: true, minMatchCharLength: 2, keys: [
  { name: 'name', weight: 0.55 }, { name: 'en_name', weight: 0.2 }, { name: 'apiName', weight: 0.15 }, { name: 'characterName', weight: 0.1 },
] })
for (const q of ['casopia', 'cassiopeaia', 'cassiopeia', 'kogmaw', 'ahrii']) {
  const hits = fuse.search(q).slice(0, 3)
  console.log(q, '->', hits.map(h => (h.item.name || h.item.apiName) + ' s=' + h.score.toFixed(3)))
}
