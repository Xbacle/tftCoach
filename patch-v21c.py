# -*- coding: utf-8 -*-
"""Fix v21c: compFilter -> uu tien bang loc; bo dieu kien units junk chan danh sach."""
p = 'src/ai/retriever.js'
s = open(p, encoding='utf-8').read()

# 1) Guard mới: có compFilter + không có tướng khớp tên trong câu -> dùng bảng lọc
old_repo = "  const repo = getRepo(data)\n\n  // RAG v2: hỏi đội hình/kinh tế mà KHÔNG nhắc thực thể cụ thể"
new_repo = """  const repo = getRepo(data)

  // RAG v2.1: thuật ngữ cộng đồng (exodia/reroll/fast...) là yêu cầu DANH SÁCH rõ ràng ->
  // vào thẳng bảng lọc, bỏ qua fuzzy match rác của các từ còn lại trong câu.
  if (analysis.compFilter) {
    const tokens = (analysis.normalized || '').split(/\\s+/).filter((tk) => tk.length >= 3)
    const strongUnit = (analysis.entities?.units || []).some((x) => {
      const u = repo.getUnit(x.apiName)
      const nameNorm = u ? normalizeText(u.name) : ''
      return tokens.some((tk) => nameNorm.includes(tk))
    })
    if (!strongUnit) {
      const d = buildDigestContext(data, analysis)
      saveCache(cacheKey, d)
      return d
    }
  }

  // RAG v2: hỏi đội hình/kinh tế mà KHÔNG nhắc thực thể cụ thể"""
assert old_repo in s, 'guard anchor'
s = s.replace(old_repo, new_repo)

# 2) nhánh danh sách: có compFilter -> cứ trả danh sách
old_list = """  if (
    (analysis.intent === 'comp_search' || analysis.intent === 'recommendation' || analysis.intent === 'economy')
    && !analysis.entities?.units?.length
  ) {
    const comps = (contextObject.chunks || []).filter((c) => c.type === 'comp')
    if (comps.length) {"""
new_list = """  const compChunks = (contextObject.chunks || []).filter((c) => c.type === 'comp')
  const wantsList = analysis.compFilter
    ? compChunks.length > 0
    : ((analysis.intent === 'comp_search' || analysis.intent === 'recommendation' || analysis.intent === 'economy')
       && !analysis.entities?.units?.length && compChunks.length > 0)
  if (wantsList) {
    const comps = compChunks
    if (comps.length) {"""
assert old_list in s, 'list anchor'
s = s.replace(old_list, new_list)

open(p, 'w', encoding='utf-8').write(s)
print('v21c OK')
