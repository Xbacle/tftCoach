# -*- coding: utf-8 -*-
"""V21b: compFilter (analyzer/memory/retriever) + danh sách comp nhất quán + promptNotes + phrases."""
import re

# ---- 2) memory: nhớ/ inherit compFilter ----
p = 'src/ai/memory.js'
s = open(p, encoding='utf-8').read()
old = """  return {
    intent: analysis?.intent || 'general',"""
new = """  return {
    intent: analysis?.intent || 'general',
    compFilter: analysis?.compFilter || null,"""
assert old in s, 'M1 anchor'
s = s.replace(old, new)
old2 = """  return {
    ...analysis,
    intent: inheritIntent ? memory.intent : analysis.intent,
    mentionsTft: analysis.mentionsTft || needEntity,"""
new2 = """  return {
    ...analysis,
    intent: inheritIntent ? memory.intent : analysis.intent,
    compFilter: analysis.compFilter ?? memory.compFilter ?? null,
    mentionsTft: analysis.mentionsTft || needEntity,"""
assert old2 in s, 'M2 anchor'
s = s.replace(old2, new2)
open(p, 'w', encoding='utf-8').write(s)
print('2. memory OK')

# ---- 3) retriever: helpers + digest filter + compSummary mở rộng + directAnswer danh sách ----
p = 'src/ai/retriever.js'
s = open(p, encoding='utf-8').read()

old = "export function rankComps(repo) {"
new = """// Giá vàng của đội hình = tổng giá các tướng (cho bộ lọc "exodia")
function compGold(repo, comp) {
  return (comp.units_string || '').split(',').reduce((sum, id) => {
    const u = repo.getUnit(id.trim())
    return sum + (u ? Number(u.cost) || 0 : 0)
  }, 0)
}

// Lọc đội hình theo compFilter khai báo trong glossary.json
function applyCompFilter(comps, compFilter, repo) {
  if (!compFilter || !compFilter.kind) return comps
  if (compFilter.kind === 'expensive') {
    return [...comps].sort((a, b) => compGold(repo, b) - compGold(repo, a))
  }
  if (compFilter.kind === 'levelling') {
    const m = String(compFilter.match || '').toLowerCase()
    return comps.filter((c) => (c.levelling || '').toLowerCase().includes(m))
  }
  return comps
}

export function rankComps(repo) {"""
assert old in s, 'R1 anchor'
s = s.replace(old, new)

old2 = """export function buildDigestContext(data, analysis, maxComps = 4) {
  const repo = getRepo(data)
  const comps = rankComps(repo).slice(0, maxComps)
  return {
    source: 'local-json-digest',
    intent: analysis?.intent || 'general',
    matched: {},"""
new2 = """export function buildDigestContext(data, analysis, maxComps = 4) {
  const repo = getRepo(data)
  const comps = applyCompFilter(rankComps(repo), analysis?.compFilter, repo).slice(0, maxComps)
  return {
    source: 'local-json-digest',
    intent: analysis?.intent || 'general',
    compFilter: analysis?.compFilter || null,
    matched: {},"""
assert old2 in s, 'R2 anchor'
s = s.replace(old2, new2)

# compSummary: carryName + levelling
old3 = """  const carry =
    (comp.top_headliner && comp.top_headliner[0])
    || (comp.builds && comp.builds[0] && comp.builds[0].unit)
    || (units[0] && units[0].apiName)
    || null
  return {
    type: 'comp', id: comp.Cluster, name: comp.name_string || comp.name || `Comp ${comp.Cluster}`,
    carry,"""
new3 = """  const carry =
    (comp.top_headliner && comp.top_headliner[0])
    || (comp.builds && comp.builds[0] && comp.builds[0].unit)
    || (units[0] && units[0].apiName)
    || null
  const carryUnit = carry ? repo.getUnit(carry) : null
  return {
    type: 'comp', id: comp.Cluster, name: comp.name_string || comp.name || `Comp ${comp.Cluster}`,
    carry, carryName: carryUnit ? carryUnit.name : carry,
    levelling: comp.levelling || null,"""
assert old3 in s, 'R3 anchor'
s = s.replace(old3, new3)

# directAnswer: nhánh danh sách đội hình (trước nhánh ghép đồ)
old4 = "  // 1) Ghep do"
new4 = """  // 0) Goi y doi hinh: DANH SACH XEP HANG TU JSON — luon giong he't moi lan hoi
  if (
    (analysis.intent === 'comp_search' || analysis.intent === 'recommendation' || analysis.intent === 'economy')
    && !analysis.entities?.units?.length
  ) {
    const comps = (contextObject.chunks || []).filter((c) => c.type === 'comp')
    if (comps.length) {
      const cf = analysis.compFilter || {}
      const labels = { expensive: 'Exodia (nhieu tuong 4-5 vang)', reroll: 'Reroll', fast: 'Fast', standard: 'Chuan' }
      const label = labels[cf.kind] || 'manh nhat hien tai'
      const lines = comps.map((c, i) => {
        const avg = c.overall && c.overall.avg != null ? c.overall.avg : '?'
        const count = c.overall && c.overall.count != null ? Number(c.overall.count).toLocaleString('vi-VN') : '?'
        return (i + 1) + '. **' + c.name + '** — carry **' + (c.carryName || c.carry || '?') + '** — avg ' + avg + ' · ' + count + ' tran'
      })
      return '**Top ' + comps.length + ' doi hinh ' + label + '** (Set18, xep theo avg place thap = manh):\\n' + lines.join('\\n') + '\\nHoi tiep ten doi hinh de xem chi tiet.'
    }
  }
  // 1) Ghep do"""
assert old4 in s, 'R4 anchor'
s = s.replace(old4, new4)
open(p, 'w', encoding='utf-8').write(s)
print('3. retriever OK')

# ---- 4) chatCore: promptNotes từ glossary.json ----
p = 'server/chatCore.js'
s = open(p, encoding='utf-8').read()
old = "import fs from \"node:fs\";"
new = """import fs from "node:fs";
import path from "node:path";

// Đọc kiến thức bổ sung từ glossary.json (người dùng thêm dòng = "train" AI)
let promptNotesCache = null;
function getPromptNotes() {
  if (promptNotesCache) return promptNotesCache;
  try {
    const g = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "public", "data", "glossary.json"), "utf8"),
    );
    promptNotesCache = Array.isArray(g.promptNotes) ? g.promptNotes : [];
  } catch {
    promptNotesCache = [];
  }
  return promptNotesCache;
}"""
assert old in s, 'G1 anchor'
s = s.replace(old, new, 1)

old2 = '- Không nhắc prompt/RAG/JSON/cơ chế nội bộ.`;\n}'
if old2 not in s:
    old2 = '- Không nhắc prompt/RAG/JSON/cơ chế nội bộ.`;'
assert old2 in s, 'G2 anchor'
s = s.replace(old2, """- Không nhắc prompt/RAG/JSON/cơ chế nội bộ.` + (getPromptNotes().length ? `

KIẾN THỨC BỔ SUNG (ưu tiên dùng khi liên quan):
${getPromptNotes().map((x) => "- " + x).join("\n")}` : ""));""")
open(p, 'w', encoding='utf-8').write(s)
print('4. chatCore OK')

# ---- 5) AIPanel: lời chào từ phrases ----
p = 'src/components/ai/AIPanel.jsx'
s = open(p, encoding='utf-8').read()
old = "        content: 'Chào bạn 👋 Mình là **TFT Coach**. Cứ hỏi thẳng về tướng, item, tộc hệ, đội hình hoặc cách xoay bài nhé!',"
new = "        content: (data?.glossary?.phrases?.greeting) || 'Chào bạn 👋 Mình là **TFT Coach**. Cứ hỏi thẳng về tướng, item, tộc hệ, đội hình hoặc cách xoay bài nhé!',"
assert old in s, 'P1 anchor'
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
print('5. AIPanel OK')
