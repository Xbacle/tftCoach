import { createContext, useContext, useEffect, useState } from 'react'

const DataContext = createContext(null)

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load ${path}`)
  return response.json()
}

async function fetchOptionalJson(path, fallback) {
  try {
    return await fetchJson(path)
  } catch {
    return fallback
  }
}

export async function loadAllTftData() {
  const [set18, comps, processed, assets, glossary] = await Promise.all([
    fetchJson('/data/Set18.json'),
    fetchJson('/data/comps.json'),
    fetchJson('/data/items_processed.json'),
    fetchOptionalJson('/data/assets.json', {}),
    fetchOptionalJson('/data/glossary.json', null),
  ])
  return { set18, comps, processed, assets, glossary }
}

export function DataProvider({ children }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    loadAllTftData()
      .then((value) => active && setData(value))
      .catch((err) => active && setError(err.message || 'Failed to load TFT data.'))
    return () => { active = false }
  }, [])

  return <DataContext.Provider value={{ data, error }}>{children}</DataContext.Provider>
}

export function useTftData() {
  return useContext(DataContext)
}
