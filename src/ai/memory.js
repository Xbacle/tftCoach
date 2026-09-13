// MEMORY (RAG v2) — nhớ thực thể vừa nhắc để giải quyết câu follow-up ("nó", "đội đó").
// Chỉ giữ MỘT khối nhớ cho phiên chat hiện tại (không lưu toàn bộ hội thoại).

const PRONOUN_RE = /\b(no|cua no|nao|do|day|hinh do|doi do|cai do|thang do|champ do|tuong do|no day)\b/

function idsOf(entities) {
  return (entities || []).map((x) => x.apiName).filter(Boolean)
}

// Cập nhật memory từ kết quả phân tích + context của lượt vừa xử lý.
export function updateMemory(analysis, contextObject) {
  const units = idsOf(analysis?.entities?.units)
  const items = idsOf(analysis?.entities?.items)
  const traits = idsOf(analysis?.entities?.traits)
  const augments = idsOf(analysis?.entities?.augments)

  // Câu không nêu tướng nhưng context có comp → nhớ carry của comp
  // (retriever gán comp.carry = topHeadliner[0] || tướng chủ lực theo build) để "nó cầm gì?" hiểu đúng.
  if (!units.length && contextObject?.chunks) {
    const comp = contextObject.chunks.find((c) => c.type === 'comp')
    if (comp?.carry) units.push(comp.carry)
  }

  // Nhớ đội hình đang bàn (comp chunk đầu tiên trong context)
  let comp = null
  if (contextObject?.chunks) {
    const c = contextObject.chunks.find((x) => x.type === 'comp')
    if (c) comp = { id: c.id, name: c.name, carryName: c.carryName || c.carry || null }
  }

  return {
    intent: analysis?.intent || 'general',
    compFilter: analysis?.compFilter || null,
    comp,
    units: [...new Set(units)].slice(0, 3),
    items: [...new Set(items)].slice(0, 3),
    traits: [...new Set(traits)].slice(0, 2),
    augments: [...new Set(augments)].slice(0, 2),
  }
}

// Câu có vẻ là follow-up: không có thực thể VÀ (ngắn hoặc chứa đại từ chỉ định).
function looksLikeFollowUp(normalized) {
  if (!normalized) return false
  const tokens = normalized.split(/\s+/).filter(Boolean)
  return tokens.length <= 6 || PRONOUN_RE.test(normalized)
}

// Gộp memory vào analysis khi câu hỏi là follow-up không nêu thực thể.
export function mergeMemory(analysis, memory) {
  if (!memory || !analysis) return analysis
  const e = analysis.entities || {}
  // Entity chỉ "strong" khi tên (>= 4 ký tự) xuất hiện trong câu — fuzzy rác không chặn memory
  const strongEntity = (list) => (list || []).some((x) => {
    if (x.fromMemory) return true
    const name = String(x.name || x.apiName || '').toLowerCase()
    if (name.length < 4) return false
    const n = analysis.normalized || ''
    return n.includes(name) || name.split(/\s+/).some((w) => w.length >= 4 && n.includes(w))
  })
  const hasEntity = Boolean(strongEntity(e.units) || strongEntity(e.items) || strongEntity(e.traits) || strongEntity(e.augments))
  const memoryHas = Boolean(memory.comp || memory.units?.length || memory.items?.length || memory.traits?.length || memory.augments?.length)
  const carryQuestion = /\b(carry|chinh luc|con nao|chinh la ai|ai carry)\b/.test(analysis.normalized || '')
  const needEntity = (!hasEntity && looksLikeFollowUp(analysis.normalized) && memoryHas) || (carryQuestion && memory.comp && !hasEntity)
  const inheritIntent = analysis.intent === 'general' && !analysis.mentionsTft && memory.intent && memory.intent !== 'general'

  if (!needEntity && !inheritIntent) return analysis

  const toEntity = (apiNames) => (apiNames || []).map((apiName) => ({ apiName, name: apiName, score: 0.4, fromMemory: true }))
  // Follow-up ngắn không nêu thực thể: DÙNG memory thay thế hoàn toàn —
  // tránh fuzzy bắt rác từ câu ngắn ("nó" khớp nhầm Morellonomicon).
  return {
    ...analysis,
    intent: inheritIntent ? memory.intent : analysis.intent,
    compFilter: analysis.compFilter ?? memory.compFilter ?? null,
    mentionsTft: analysis.mentionsTft || needEntity,
    entities: needEntity ? {
      units: toEntity(memory.units),
      items: toEntity(memory.items),
      traits: toEntity(memory.traits),
      augments: toEntity(memory.augments),
    } : e,
    comp: memory.comp || null,
  }
}
