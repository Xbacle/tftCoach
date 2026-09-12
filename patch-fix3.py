# -*- coding: utf-8 -*-
"""Fix round 3: word-boundary intent + stoplist từ generic."""

# 1) analyzer.js — intentFromQuery dùng word boundary, không substring
p = 'src/ai/analyzer.js'
s = open(p, encoding='utf-8').read()

old = """function intentFromQuery(text) {
  const normalized = normalizeText(text)
  if (GREETING_RE.test(normalized)) return 'greeting'
  for (const rule of INTENT_RULES) if (rule.keys.some((key) => normalized.includes(normalizeText(key)))) return rule.id
  return 'general'
}"""
new = """function intentFromQuery(text) {
  const normalized = normalizeText(text)
  if (GREETING_RE.test(normalized)) return 'greeting'
  // Word boundary: 'he'/'toc' không được khớp trong 'ghep'/'warmog' (bug thật đã gặp)
  for (const rule of INTENT_RULES) {
    const hit = rule.keys.some((key) => {
      const k = normalizeText(key)
      const re = new RegExp('(^|\\\\s)' + k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '($|\\\\s)')
      return re.test(normalized)
    })
    if (hit) return rule.id
  }
  return 'general'
}"""
assert old in s, 'intent anchor'
s = s.replace(old, new)

# 2) analyzer.js — stoplist từ generic khi tìm thực thể
old_stop = """  const terms = [...new Set([normalized, ...tokenize(normalized)])].filter((x) => x.length >= 2)
  const hits = []"""
new_stop = """  const terms = [...new Set([normalized, ...tokenize(normalized)])]
    .filter((x) => x.length >= 2 && !STOP_TOKENS.has(x))
  const hits = []"""
assert old_stop in s
s = s.replace(old_stop, new_stop)

old_al = "const ALIASES = new Map(["
new_al = """// Từ generic (đại từ/từ chỉ thị/game-speak) — KHÔNG dùng làm token tìm thực thể,
// tránh fuzzy bắt rác ("meta", "hình", "mạnh"... khớp nhầm tên tướng).
const STOP_TOKENS = new Set([
  'meta', 'hien', 'tai', 'nao', 'manh', 'nhat', 'choi', 'cho', 'di', 'len', 'xuong',
  'tot', 'yeu', 'vao', 'ra', 'nguoi', 'team', 'dau', 'tran', 'ban', 'minh', 'muon',
  'can', 'phai', 'nen', 'the', 'gi', 'cam', 'dung', 'ghep', 'moc', 'kich', 'hoat',
  'dat', 'tien', 'vang', 'cap', 'level', 'roll', 'hinh', 'doi', 'toc', 'he',
  'la', 'va', 'voi', 'khi', 'nhung', 'thi', 'co', 'khong', 'sao', 'nhieu', 'it',
])

const ALIASES = new Map(["""
assert old_al in s
s = s.replace(old_al, new_al)
open(p, 'w', encoding='utf-8').write(s)
print('analyzer fix OK')

# 3) retriever.js — recipe: dùng items_processed (nơi chứa composition)
p2 = 'src/ai/retriever.js'
s2 = open(p2, encoding='utf-8').read()

old_recipe = """  // 1) Ghép đồ
  if (item && /(ghep|cong thuc|recipe|lam tu|tu nhung gi)/.test(n)) {
    const comps = repo.getComponentsForItem(item).filter(Boolean)
    if (comps.length) {
      return '**' + item.name + '** ghép từ: **' + comps.map((c) => c.name).join(' + ') + '** _(theo dữ liệu Set18)_'
    }
  }"""
new_recipe = """  // 1) Ghép đồ — composition nằm trong items_processed.json
  if (item && /(ghep|cong thuc|recipe|lam tu|tu nhung gi)/.test(n)) {
    const processedItems = (data.processed && data.processed.itemNames) || {}
    const entry = Object.values(processedItems).find((e) => e && (e.apiName === item.apiName || e.name === item.name))
    const compIds = entry ? (entry.composition || entry.builds || []) : (item.composition || [])
    const comps = compIds.map((id) => repo.getItem(id)).filter(Boolean)
    if (comps.length) {
      return '**' + item.name + '** ghép từ: **' + comps.map((c) => c.name).join(' + ') + '** _(theo dữ liệu Set18)_'
    }
  }"""
assert old_recipe in s2
s2 = s2.replace(old_recipe, new_recipe)
open(p2, 'w', encoding='utf-8').write(s2)
print('retriever recipe fix OK')
