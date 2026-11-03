import type { DictionaryEntryView } from '@shared/types'

interface CacheEntry {
  entries: DictionaryEntryView[]
  promise: Promise<DictionaryEntryView[]> | null
}
const cache = new Map<string, CacheEntry>()

export function invalidateDictionaryCache(projectId?: string): void {
  if (projectId) cache.delete(projectId)
  else cache.clear()
}

export async function loadSuggestions(projectId: string): Promise<DictionaryEntryView[]> {
  const existing = cache.get(projectId)
  if (existing?.entries?.length) return existing.entries
  if (existing?.promise) return existing.promise
  const promise = window.api.dictionary.suggestions(projectId).then(result => {
    if (!result.ok) throw new Error(result.error)
    if (cache.get(projectId)?.promise === promise) cache.set(projectId, { entries: result.data, promise: null })
    return result.data
  }).catch(error => { if (cache.get(projectId)?.promise === promise) cache.delete(projectId); throw error })
  cache.set(projectId, { entries: existing?.entries ?? [], promise })
  return promise
}
