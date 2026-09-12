import { uniqueByKey } from '../utils/labels'

function clean(value) { return String(value ?? '').trim() }
function normalizeId(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '') }
function resolveDa18ToTft18(value) { const id = clean(value); return id.startsWith('DA_18_') ? `TFT18_${id.slice(6)}` : id }
function resolveTft18ToDa18(value) { const id = clean(value); return id.startsWith('TFT18_') ? `DA_18_${id.slice(6)}` : id }

function toMaps(list) {
  const map = new Map()
  for (const entity of list || []) {
    const candidates = [entity.apiName, entity.id, entity.name, entity.en_name, entity.characterName, ...(entity.assetNames || []), ...(entity.traitApiNames || [])]
    for (const candidate of candidates) if (candidate) map.set(normalizeId(candidate), entity)
  }
  return map
}

export function createTftRepository(data) {
  const { set18, comps, processed } = data
  const allUnits = set18.units || []
  const isPlayableUnit = (unit) => unit?.shopUnit === true
  const units = allUnits.filter(isPlayableUnit)
  const otherUnits = allUnits.filter((unit) => !isPlayableUnit(unit))
  const traits = set18.traits || []
  const items = set18.items || []
  const augments = set18.augments || []
  const unitMap = toMaps(units)
  const traitMap = toMaps(traits)
  const itemMap = toMaps(items)
  const augmentMap = toMaps(augments)
  const otherUnitMap = toMaps(otherUnits)
  const processedUnits = processed?.units || {}
  const processedItems = processed?.itemNames || {}
  const clusterDetails = comps?.results?.data?.cluster_details || {}
  const extras = set18.extras || {}
  const roles = set18.roles || {}
  const roleData = set18.roleData || {}

  const getByMap = (map, id, allowDa = true) => {
    if (!id) return null
    return map.get(normalizeId(id))
      || (allowDa && map.get(normalizeId(resolveDa18ToTft18(id))))
      || (allowDa && map.get(normalizeId(resolveTft18ToDa18(id))))
      || null
  }

  const getUnit = (id) => getByMap(unitMap, id)
  const getOtherUnit = (id) => getByMap(otherUnitMap, id)
  const getTrait = (id) => getByMap(traitMap, id)
  const getItem = (id) => getByMap(itemMap, id)
  const getAugment = (id) => getByMap(augmentMap, id, false)

  const getUnitStats = (unit) => {
    if (!unit) return null
    const ids = [unit.apiName, ...(unit.assetNames || []), resolveTft18ToDa18(unit.apiName)]
    return ids.map((id) => processedUnits[id]).find(Boolean) || null
  }

  const getItemStats = (item) => {
    if (!item) return null
    const ids = [item.apiName, item.id, resolveTft18ToDa18(item.apiName)]
    return ids.map((id) => processedItems[id]).find(Boolean) || null
  }

  const getComps = () => Object.values(clusterDetails)
  const getComp = (id) => clusterDetails[String(id)] || null

  const getRelatedCompsForUnit = (unit) => getComps().filter((comp) =>
    (comp.units_string || '').split(',').map((x) => x.trim()).some((id) => getUnit(id)?.apiName === unit?.apiName),
  )

  const getRelatedCompsForItem = (item) => getComps().filter((comp) =>
    Object.keys(comp.build_items || {}).some((id) => getItem(id)?.apiName === item?.apiName),
  )

  const getRelatedUnitsForTrait = (trait) => {
    if (!trait) return []
    const traitId = trait.apiName
    const declared = (trait.units || []).map((entry) => getUnit(entry?.unit || entry)).filter(Boolean)
    const byUnitTraits = units.filter((unit) => (unit.traitApiNames || []).some((id) => {
      const resolved = getTrait(id)
      return resolved?.apiName === traitId
    }))
    return uniqueByKey([...declared, ...byUnitTraits], (unit) => unit.apiName)
      .sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || (a.name || '').localeCompare(b.name || ''))
  }

  const getRelatedCompsForTrait = (trait) => {
    if (!trait) return []
    // traits_string co hau so muc (_1/_2): so khop bang prefix da chuan hoa
    const key = normalizeId(trait.apiName)
    if (!key) return []
    return getComps().filter((comp) =>
      (comp.traits_string || '').split(',').map((id) => normalizeId(id)).some((id) => id === key || id.startsWith(key)),
    )
  }

  const getRelatedUnitsForItem = (item) => {
    const stats = getItemStats(item)
    return (stats?.units || []).map((x) => getUnit(x.unit)).filter(Boolean)
  }

  const getComponentsForItem = (item) => (item?.composition || []).map((id) => getItem(id)).filter(Boolean)
  const getUpgradeItem = (item) => item?.upgrade ? getItem(item.upgrade) : null
  const getBaseItem = (item) => item?.from ? getItem(item.from) : null
  const getAssociatedTraits = (entity) => (entity?.associatedTraits || []).map((id) => getTrait(id)).filter(Boolean)
  const getIncompatibleTraits = (entity) => (entity?.incompatibleTraits || []).map((id) => getTrait(id)).filter(Boolean)

  const getCompUnits = (comp) => uniqueByKey(
    (comp?.units_string || '').split(',').map((id) => getUnit(id.trim())).filter(Boolean),
    (unit) => unit.apiName,
  )

  const resolveTraitEffects = (trait, count) => {
    if (!trait) return { active: null, next: null }
    const effects = Array.isArray(trait.effects) ? trait.effects : []
    const sorted = effects
      .filter((effect) => Number.isFinite(Number(effect?.minUnits)))
      .sort((a, b) => Number(a.minUnits) - Number(b.minUnits))
    const active = sorted.filter((effect) => Number(effect.minUnits) <= count).at(-1) || null
    const next = sorted.find((effect) => Number(effect.minUnits) > count) || null
    return { active, next }
  }

  const getTraitActivation = (trait, count) => {
    if (!trait) return null
    const { active, next } = resolveTraitEffects(trait, count)
    return {
      trait,
      count,
      active,
      next,
      activeThreshold: active ? Number(active.minUnits) : 0,
      nextThreshold: next ? Number(next.minUnits) : null,
      isActive: Boolean(active),
    }
  }

  const getCompTraitActivations = (comp) => {
    const unitsInComp = getCompUnits(comp)
    const counts = new Map()
    const seenTraitIds = new Set()
    for (const unit of unitsInComp) {
      for (const traitId of unit.traitApiNames || []) {
        const trait = getTrait(traitId)
        if (!trait) continue
        counts.set(trait.apiName, (counts.get(trait.apiName) || 0) + 1)
        seenTraitIds.add(trait.apiName)
      }
    }
    return [...seenTraitIds]
      .map((traitId) => getTrait(traitId))
      .filter(Boolean)
      .map((trait) => getTraitActivation(trait, counts.get(trait.apiName) || 0))
      .filter(Boolean)
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || Number(b.activeThreshold) - Number(a.activeThreshold) || Number(b.count) - Number(a.count) || a.trait.name.localeCompare(b.trait.name))
  }

  const getCompItems = (comp) => uniqueByKey(
    Object.keys(comp?.build_items || {}).map((id) => getItem(id)).filter(Boolean),
    (item) => item.apiName || item.id,
  )

  return {
    getUnits: () => units,
    getAllUnits: () => allUnits,
    getOtherUnits: () => otherUnits,
    isPlayableUnit,
    getUnit,
    getOtherUnit,
    getUnitStats,
    getItems: () => items,
    getItem,
    getItemStats,
    getComponentsForItem,
    getUpgradeItem,
    getBaseItem,
    getAssociatedTraits,
    getIncompatibleTraits,
    getTraits: () => traits,
    getTrait,
    getTraitActivation,
    getAugments: () => augments,
    getAugment,
    getComps,
    getComp,
    getCompUnits,
    getCompTraits: (comp) => getCompTraitActivations(comp).map((entry) => entry.trait),
    getCompTraitActivations,
    getCompItems,
    getRelatedCompsForUnit,
    getRelatedCompsForItem,
    getRelatedUnitsForTrait,
    getRelatedCompsForTrait,
    getRelatedUnitsForItem,
    getRoles: () => roles,
    getRoleData: () => roleData,
    getExtras: () => extras,
    getSetData: () => set18,
    getDataSummary: () => ({ units: units.length, otherUnits: otherUnits.length, allUnitEntities: allUnits.length, traits: traits.length, items: items.length, augments: augments.length, encounters: (set18.encounters || []).length, charms: (set18.charms || []).length }),
  }
}

export { normalizeId }
