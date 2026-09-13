// ============================================================
// GLOSSARY (RAG v2.2) — "Kiến thức là dữ liệu"
// Toàn bộ thuật ngữ/teencode/FAQ/giọng nói nằm trong public/data/glossary.json.
// Muốn "train" AI: sửa file đó -> F5 (không cần build, không cần sửa code).
// Module này gộp: mặc định built-in (phòng khi file thiếu) + bản tùy chỉnh trong data.
// ============================================================

const DEFAULTS = {
  aliases: [],
  communityTerms: [],
  faq: [],
  promptNotes: [],
  phrases: {
    greeting: 'Chào bạn! Mình là TFT Coach. Cứ hỏi về tướng, đội hình, trang bị nhé!',
    refusal: 'Mình chỉ hỗ trợ các câu hỏi về Đấu Trường Chân Lý. Bạn cứ hỏi về tướng, đội hình, trang bị nhé!',
    noData: 'Không có dữ liệu trong Set18 của TFTCoach.',
    sourceNote: '(theo dữ liệu Set18)',
  },
}

export function mergeGlossary(custom) {
  const g = custom && typeof custom === 'object' ? custom : {}
  return {
    aliases: Array.isArray(g.aliases) ? g.aliases : DEFAULTS.aliases,
    communityTerms: Array.isArray(g.communityTerms) ? g.communityTerms : DEFAULTS.communityTerms,
    faq: Array.isArray(g.faq) ? g.faq : DEFAULTS.faq,
    promptNotes: Array.isArray(g.promptNotes) ? g.promptNotes : DEFAULTS.promptNotes,
    phrases: { ...DEFAULTS.phrases, ...(g.phrases || {}) },
  }
}

export function getGlossary(data) {
  return mergeGlossary(data?.glossary)
}

// Chuẩn hóa 1 chuỗi (giống text.js normalizeText — giữ đồng bộ, tránh import vòng)
export function normLike(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Danh sách alias [{from, to}] đã chuẩn hóa — analyzer dùng khi tìm thực thể
export function getAliasList(glossary) {
  return (glossary.aliases || []).map((a) => ({ from: normLike(a.from), to: normLike(a.to) })).filter((a) => a.from && a.to)
}

// Thuật ngữ cộng đồng — build regex từ pattern, kèm compFilter + explain
export function getCommunityTerms(glossary) {
  return (glossary.communityTerms || []).map((t) => ({
    pattern: t.pattern,
    compFilter: t.compFilter || null,
    explain: t.explain || '',
    re: new RegExp('\\b' + String(t.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'),
  })).filter((t) => t.pattern)
}

export function getFAQ(glossary) {
  return (glossary.faq || []).map((f) => ({
    match: (f.match || []).map((m) => normLike(m)).filter(Boolean),
    requiresEntity: f.requiresEntity || null,
    template: f.template || null,
  })).filter((f) => f.match.length && f.template)
}

export function getPhrases(glossary) {
  return glossary.phrases
}

export function getPromptNotes(glossary) {
  return glossary.promptNotes || []
}
