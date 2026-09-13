// ============================================================
// LỚP 2 — RETRIEVAL (RAG v4): tìm Top-K chunk liên quan nhất
// Input : vector câu hỏi (từ /api/embed) + rag_store.json (đã nạp)
// Output: Top-K chunk (kèm điểm hybrid = cosine + trùng từ khóa)
// ============================================================
import { normalizeText } from './text.js'

export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// Top-K chunk: điểm ngữ nghĩa (cosine) + điểm trùng từ khóa (hybrid search)
export function searchChunks(store, queryVector, queryText, topK = 4) {
  if (!store || !store.chunks || !queryVector) return []
  const tokens = new Set(normalizeText(queryText).split(/\s+/).filter((t) => t.length >= 3))
  return store.chunks
    .map((c) => {
      const semantic = cosine(queryVector, c.vector)
      const lower = c.text.toLowerCase()
      let keyword = 0
      for (const tk of tokens) if (lower.includes(tk)) keyword += 0.03
      return { text: c.text, type: c.type, id: c.id, score: semantic + keyword, semantic }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
