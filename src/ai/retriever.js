import { createTftRepository } from '../services/tftRepository'
import { analyzeQuery, resolveUnitNames } from './analyzer'
import { getCompIdentity } from '../utils/compNaming'
import { clampText, normalizeText } from './text'

const REPO_CACHE = new WeakMap()
// CACHE (RAG v2): cùng intent + entity -> dùng lại context, tránh tính lại và đảm bảo NHẤT QUÁN.
const CONTEXT_CACHE = new Map()
const CONTEXT_CACHE_MAX = 200

function getRepo(data) {
  if (!REPO_CACHE.has(data)) REPO_CACHE.set(data, createTftRepository(data))
  return REPO_CACHE.get(data)
}

function unique(items) {
  return [...new Map(items.filter(Boolean).map((x) => [x.apiName || x.id || x.Cluster || x.name, x])).values()]
}

function unitSummary(repo, unit) {
  const stats = repo.getUnitStats(unit)
  return {
    type: 'unit', name: unit.name, en_name: unit.en_name, apiName: unit.apiName, cost: unit.cost,
    traits: unit.traits, role: unit.role, stats: unit.stats,
    ability: unit.ability ? { name: unit.ability.name, description: clampText(unit.ability.description || unit.ability.desc, 650) } : null,
    recommendedItems: (unit.recommendedItems || []).slice(0, 5),
    performance: stats ? { avg: stats.avg, pick: stats.pick, count: stats.count, items: (stats.items || []).slice(0, 5) } : null,
  }
}

function itemSummary(repo, item) {
  const stats = repo.getItemStats(item)
  return {
    type: 'item', name: item.name, en_name: item.en_name, apiName: item.apiName,
    desc: clampText(item.desc, 650), statLine: clampText(item.statLine, 250), composition: item.composition,
    performance: stats ? { avg: stats.avg, pick: stats.pick, count: stats.count, units: (stats.units || []).slice(0, 5) } : null,
  }
}

function traitSummary(trait) {
  return {
    type: 'trait', name: trait.name, en_name: trait.en_name,
    desc: clampText(trait.desc, 650), effects: (trait.effects || []).slice(0, 4),
    units: (trait.units || []).slice(0, 8),
  }
}

function augmentSummary(augment) {
  return {
    type: 'augment', name: augment.name, apiName: augment.apiName,
    desc: clampText(augment.desc || augment.description, 650),
  }
}

function compSummary(repo, comp) {
  const units = repo.getCompUnits(comp)
  const traits = repo.getCompTraitActivations(comp)
  const carry =
    (comp.top_headliner && comp.top_headliner[0])
    || (comp.builds && comp.builds[0] && comp.builds[0].unit)
    || (units[0] && units[0].apiName)
    || null
  return {
    type: 'comp', id: comp.Cluster,
    name: (getCompIdentity(comp, repo).title) || comp.name_string || `Comp ${comp.Cluster}`,
    style: (getCompIdentity(comp, repo).style) || null,
    carry, carryName: (carry && repo.getUnit(carry) ? repo.getUnit(carry).name : carry) || null,
    unitNames: units.map((u) => u.name).slice(0, 8),
    traitNames: traits.slice(0, 6).map((x) => ({ name: x.trait.name, count: x.count, activeThreshold: x.activeThreshold, nextThreshold: x.nextThreshold, active: x.isActive })),
    overall: comp.overall, difficulty: comp.difficulty, levelling: comp.levelling,
    topHeadliner: comp.top_headliner, topItems: (comp.top_itemNames || []).slice(0, 5), topAugments: (comp.top_augments || []).slice(0, 4),
  }
}

// Khi câu hỏi liên quan TFT nhưng không nhận diện được thực thể cụ thể,
// gửi "digest" tổng quan (top đội hình mạnh) để AI vẫn có dữ liệu gốc để trả lời.
export function buildDigestContext(data, analysis, maxComps = 4) {
  const repo = getRepo(data)
  const comps = applyCompFilter(rankComps(repo), analysis?.compFilter, repo).slice(0, maxComps)
  return {
    source: 'local-json-digest',
    intent: analysis?.intent || 'general',
    compFilter: analysis?.compFilter || null,
    matched: {},
    rankingRule: 'Danh sách ĐÃ xếp hạng (avgPlace tăng dần = mạnh hơn, số trận giảm dần = đáng tin hơn). KHI GỢI Ý: giới thiệu ĐỦ các đội theo ĐÚNG thứ tự, dùng ĐÚNG tên (name), carry (carryName) và số liệu (avg/count) của từng đội.',
    chunks: comps.map((comp) => compSummary(repo, comp)),
    dataSummary: repo.getDataSummary(),
  }
}

// Xep hang doi hinh chuan (RAG v2): vi tri trung binh thap hon = manh;
// bang nhau thi nhieu tran hon = dang tin hon; cung luc do thi theo Cluster (on dinh 100%).
// Gia vang doi hinh = tong gia cac tuong (bo loc "exodia")
function compGold(repo, comp) {
  return (comp.units_string || '').split(',').reduce((sum, id) => {
    const u = repo.getUnit(id.trim())
    return sum + (u ? Number(u.cost) || 0 : 0)
  }, 0)
}

// Loc doi hinh theo compFilter khai bao trong glossary.json
function applyCompFilter(comps, compFilter, repo) {
  if (!compFilter || !compFilter.kind) return comps
  if (compFilter.kind === 'expensive') {
    return [...comps].sort((a, b) => compGold(repo, b) - compGold(repo, a))
  }
  if (compFilter.kind === 'levelling') {
    const m = String(compFilter.match || '').toLowerCase()
    return comps.filter((c) => (c.levelling || '').toLowerCase().includes(m))
  }
  if (compFilter.kind === 'standard') {
    return comps.filter((c) => /standard/i.test(c.levelling || ''))
  }
  return comps
}

export function rankComps(repo) {
  return repo.getComps()
    .map((comp) => ({ comp, avg: Number(comp?.overall?.avg) || 99, count: Number(comp?.overall?.count) || 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => a.avg - b.avg || b.count - a.count || String(a.comp.Cluster).localeCompare(String(b.comp.Cluster)))
    .map((x) => x.comp)
}

export function retrieveContext(data, analysis, maxChunks = 5) {
  if (!analysis || analysis.intent === 'greeting') return null
  // CACHE: key = intent + entity ids (da sort) - cung kieu cau luon ra cung context.
  const cacheKey = JSON.stringify([
    analysis.intent,
    ...(analysis.entities?.units || []).map((x) => x.apiName).sort(),
    ...(analysis.entities?.items || []).map((x) => x.apiName).sort(),
    ...(analysis.entities?.traits || []).map((x) => x.apiName).sort(),
    ...(analysis.entities?.augments || []).map((x) => x.apiName).sort(),
  ])
  if (CONTEXT_CACHE.has(cacheKey)) return CONTEXT_CACHE.get(cacheKey)

  const hasEntities = Boolean(
    analysis.entities?.units?.length
    || analysis.entities?.items?.length
    || analysis.entities?.traits?.length
    || analysis.entities?.augments?.length,
  )
  if (analysis.intent === 'general') {
    // Chỉ truy xuất khi đã xác định câu hỏi thuộc TFT (mentionsTft = tên thực thể
    // xuất hiện nguyên vẹn trong câu hỏi hoặc có từ khóa game).
    if (!analysis.mentionsTft) { saveCache(cacheKey, null); return null }
    if (!hasEntities) { const d = buildDigestContext(data, analysis); saveCache(cacheKey, d); return d }
  }
  const repo = getRepo(data)
  const units = resolveUnitNames(repo, analysis)
  const unitNames = new Set(units.map((u) => u.apiName))
  const itemIds = (analysis.entities?.items || []).map((x) => repo.getItem(x.apiName) || repo.getItem(x.name)).filter(Boolean)
  const traitIds = (analysis.entities?.traits || []).map((x) => repo.getTrait(x.apiName) || repo.getTrait(x.name)).filter(Boolean)
  const augmentIds = (analysis.entities?.augments || []).map((x) => repo.getAugment(x.apiName) || repo.getAugment(x.name)).filter(Boolean)
  // RAG v2.1: thuat ngu cong dong (exodia/reroll/fast...) la yeu cau DANH SACH ro rang ->
  // vao thang bang loc, bo qua fuzzy match rac cua cac tu con lai trong cau.
  if (analysis.compFilter) {
    const tokens = (analysis.normalized || '').split(/\s+/).filter((tk) => tk.length >= 3)
    const strongUnit = (analysis.entities?.units || []).some((x) => {
      const u = repo.getUnit(x.apiName)
      const nameNorm = u ? normalizeText(u.name) : ''
      return [...tokens].some((tk) => nameNorm.includes(tk))
    })
    if (!strongUnit) {
      const d = buildDigestContext(data, analysis)
      saveCache(cacheKey, d)
      return d
    }
  }
  // RAG v2: hoi doi hinh/kinh te ma KHONG nhac thuc the cu the -> dung bang xep hang
  // (avg place thap nhat + nhieu tran nhat), tranh fuzzy bat rac lam lech thu tu.
  if (
    (analysis.intent === 'comp_search' || analysis.intent === 'recommendation' || analysis.intent === 'economy')
    && !units.length && !itemIds.length && !traitIds.length && !augmentIds.length
  ) {
    const d = buildDigestContext(data, analysis)
    saveCache(cacheKey, d)
    return d
  }

  const relatedComps = []
  for (const unit of units.slice(0, 2)) relatedComps.push(...repo.getRelatedCompsForUnit(unit))
  for (const trait of traitIds.slice(0, 1)) relatedComps.push(...repo.getRelatedCompsForTrait(trait))

  const compRank = new Map(rankComps(repo).map((c, i) => [c.Cluster, i])) // thu hang toan cuc lam tie-breaker on dinh
  const rankedComps = unique(relatedComps)
    .map((comp) => {
      const compUnits = repo.getCompUnits(comp)
      const overlap = compUnits.filter((u) => unitNames.has(u.apiName)).length
      return { comp, overlap }
    })
    .sort((a, b) => b.overlap - a.overlap
      || (compRank.get(a.comp.Cluster) ?? 999) - (compRank.get(b.comp.Cluster) ?? 999))
    .slice(0, 3)

  const selectedItems = itemIds.length
    ? itemIds.slice(0, 3)
    : unique(units.flatMap((u) => (Array.isArray(u.recommendedItems) ? u.recommendedItems : []).map((x) => repo.getItem(x)).filter(Boolean))).slice(0, 3)
  const selectedTraits = traitIds.length
    ? traitIds.slice(0, 2)
    : unique(units.flatMap((u) => (u.traitApiNames || []).map((id) => repo.getTrait(id)).filter(Boolean))).slice(0, 2)

  // RAG v2: hoi do theo toc/doi hinh ma chua co tuong -> danh dau de suy tuong tu toc
  const needTraitUnits = !selectedItems.length && selectedTraits.length > 0

  const chunks = []
  units.slice(0, 2).forEach((u) => chunks.push(unitSummary(repo, u)))
  selectedItems.forEach((item) => chunks.push(itemSummary(repo, item)))
  selectedTraits.forEach((trait) => chunks.push(traitSummary(trait)))
  augmentIds.slice(0, 2).forEach((augment) => chunks.push(augmentSummary(augment)))

  // RAG v2: suy ra tuong cua toc da chon, them chunk tuong + do khuyen dung cua chung
  if (needTraitUnits) {
    const traitUnitList = unique(selectedTraits.flatMap(
      (t) => repo.getUnits().filter((u) => (u.traitApiNames || []).includes(t.apiName)),
    ))
    const recItems = unique(traitUnitList.flatMap(
      (u) => (Array.isArray(u.recommendedItems) ? u.recommendedItems : []).map((x) => repo.getItem(x)).filter(Boolean),
    )).slice(0, 4)
    selectedItems.push(...recItems)
    traitUnitList.slice(0, 3).forEach((u) => chunks.push(unitSummary(repo, u)))
  }
  rankedComps.forEach(({ comp, overlap }) => chunks.push({ ...compSummary(repo, comp), boardOverlap: overlap }))

  const priority = (chunk) => {
    if (analysis.intent === 'comp_search') return chunk.type === 'comp' ? 0 : chunk.type === 'unit' ? 1 : 2
    if (analysis.intent === 'item_build') return chunk.type === 'item' ? 0 : chunk.type === 'unit' ? 1 : 2
    if (analysis.intent === 'trait') return chunk.type === 'trait' ? 0 : 1
    if (analysis.intent === 'augment') return chunk.type === 'augment' ? 0 : 1
    if (analysis.intent === 'economy') return chunk.type === 'comp' ? 0 : 1
    return chunk.type === 'unit' ? 0 : 1
  }

  const result = {
    source: 'local-json-rag',
    intent: analysis.intent,
    matched: {
      units: units.slice(0, 3).map((u) => u.name),
      items: itemIds.slice(0, 3).map((i) => i.name),
      traits: traitIds.slice(0, 2).map((t) => t.name),
      augments: augmentIds.slice(0, 2).map((a) => a.name),
    },
    chunks: unique(chunks).sort((a, b) => priority(a) - priority(b) || String(a.id).localeCompare(String(b.id))).slice(0, maxChunks),
    dataSummary: repo.getDataSummary(),
  }
  saveCache(cacheKey, result)
  return result
}

function saveCache(key, value) {
  if (CONTEXT_CACHE.size >= CONTEXT_CACHE_MAX) CONTEXT_CACHE.delete(CONTEXT_CACHE.keys().next().value)
  CONTEXT_CACHE.set(key, value)
}

// ============================================================
// TRA LOI TRUC TIEP (RAG v2): cau tinh - khong goi Gemini, so lieu lay nguyen tu JSON.
// Tra ve chuoi Markdown, hoac null neu khong chac chan (de Gemini xu ly).
// ============================================================
export function directAnswer(data, analysis, contextObject, memory = null) {
  if (!data || !analysis || !contextObject) return null
  const repo = getRepo(data)
  const n = analysis.normalized || ''
  const unit = (analysis.entities?.units || []).map((x) => repo.getUnit(x.apiName)).find(Boolean)
  // Chọn entity khớp TÊN trong câu hỏi nhất (entity đầu tiên có thể là Spatula rác)
  const pickBest = (entities) => {
    const tokens = new Set((n || '').split(/\s+/))
    let best = null
    let bestScore = -1
    for (const x of entities || []) {
      const it = repo.getItem(x.apiName) || repo.getItem(x.name)
      if (!it) continue
      const nameNorm = normalizeText(it.name)
      let overlap = 0
      for (const tk of tokens) if (tk.length >= 3 && nameNorm.includes(tk)) overlap += 1
      const sc = overlap * 10 - (x.score || 0)
      if (sc > bestScore) { bestScore = sc; best = it }
    }
    return best
  }
  const item = pickBest(analysis.entities?.items)
  const trait = (analysis.entities?.traits || []).map((x) => repo.getTrait(x.apiName) || repo.getTrait(x.name)).find(Boolean)
  const augment = (analysis.entities?.augments || []).map((x) => repo.getAugment(x.apiName) || repo.getAugment(x.name)).find(Boolean)

  // 0b) Follow-up: "đội này con nào carry?" — dữ liệu từ memory (đội đang bàn)
  if (memory && memory.comp && memory.comp.carryName && /\b(carry|chinh luc|con nao|chinh la ai|ai carry)\b/.test(n)) {
    return '**Carry chính của ' + memory.comp.name + ' là ' + memory.comp.carryName + '**. Trang bị và tiến trình chi tiết có ở trang chi tiết đội hình — hoặc hỏi "AHRI lên đồ gì" để mình gợi ý.'
  }
  // 0c) Hỏi về 1 tướng (không hỏi đồ): đọc ra các đội hình chứa tướng đó
  if (unit && analysis.intent !== 'item_build' && !/(cam gi|dung gi|len do|item nao)/.test(n)) {
    const related = rankComps(repo).filter(
      (c) => (c.units_string || '').split(',').map((x) => x.trim()).some((id) => {
        const u = repo.getUnit(id)
        return u && u.apiName === unit.apiName
      }),
    ).slice(0, 3)
    if (related.length) {
      const lines = related.map((c, i) => {
        const idn = getCompIdentity(c, repo)
        const avg = c.overall && c.overall.avg != null ? c.overall.avg : '?'
        const count = c.overall && c.overall.count != null ? Number(c.overall.count).toLocaleString('vi-VN') : '?'
        return (i + 1) + '. **' + idn.title + '** — carry **' + (idn.carry && idn.carry.name ? idn.carry.name : '?') + '** — avg ' + avg + ' · ' + count + ' trận'
      })
      return '**' + unit.name + '** thường chơi trong các đội hình sau (Set18):\n' + lines.join('\n') + '\nHỏi tiếp tên đội hình để xem cách lên đồ và tiến trình.'
    }
  }
  // 1) Ghép đồ — composition nằm trong items_processed.json
  if (item && /(ghep|cong thuc|recipe|lam tu|tu nhung gi)/.test(n)) {
    const processedItems = (data.processed && data.processed.itemNames) || {}
    const entry = Object.values(processedItems).find((e) => e && (e.apiName === item.apiName || e.name === item.name))
    const compIds = entry ? (entry.composition || entry.builds || []) : (item.composition || [])
    const comps = compIds.map((id) => repo.getItem(id)).filter(Boolean)
    if (comps.length) {
      return '**' + item.name + '** ghép từ: **' + comps.map((c) => c.name).join(' + ') + '** _(theo dữ liệu Set18)_'
    }
  }
  // 2) Moc trait
  if (trait && analysis.intent === 'trait') {
    const effects = (trait.effects || []).slice(0, 5)
    if (effects.length) {
      const lines = effects.map((e) => ({ c: e.count ?? e.min ?? e.threshold ?? e.value, d: e.desc ?? e.description ?? e.text })).filter((e) => e.c !== undefined && e.d).map((e) => '- **' + e.c + '** tướng: ' + String(e.d).slice(0, 140))
      return '**' + trait.name + '** — các mốc kích hoạt:\n' + lines.join('\n') + ' _(theo dữ liệu Set18)_'
    }
  }
  // 3) Do khuyen dung cho tuong
  if (unit && (analysis.intent === 'item_build' || /(cam gi|dung gi|len do|item nao)/.test(n))) {
    const stats = repo.getUnitStats(unit)
    const perfItems = (stats ? stats.items || [] : []).slice(0, 3)
      .map((x) => { const it = repo.getItem(x.itemName || x.apiName); return it ? it.name : null }).filter(Boolean)
    const rec = (unit.recommendedItems || []).filter((x) => typeof x === 'string' && repo.getItem(x))
      .map((x) => repo.getItem(x).name).filter(Boolean)
    const list = [...new Set([...perfItems, ...rec])].slice(0, 3)
    if (list.length) return '**' + unit.name + '** (' + unit.cost + '-cost) thuong dung: **' + list.join('**, **') + '** _(theo du lieu Set18)_'
  }
  // 4) Augment mo ta
  if (augment && analysis.intent === 'augment') {
    const d = augment.desc || augment.description
    if (d) return '**' + augment.name + '** (' + (augment.rarity || '?') + '): ' + String(d).slice(0, 220) + ' _(theo du lieu Set18)_'
  }
  return null
}

export function buildContextText(context, maxChars = 7000) {
  if (!context) return ''
  const raw = JSON.stringify(context)
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars)}...[context truncated]`
}

export function retrieveForQuery(data, message, history = []) {
  const analysis = analyzeQuery(data, message, history)
  return { analysis, context: retrieveContext(data, analysis) }
}
