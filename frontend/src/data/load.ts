import { api } from '../api/client'
import type { Dataset } from '../domain/types'

/** Loads what every page needs: headline stats and the employer list. Vacancies are paged on demand. */
export async function loadDataset(signal?: AbortSignal): Promise<Dataset> {
  const [stats, employers] = await Promise.all([api.stats(signal), api.employers(signal)])
  const regions = [...stats.regions_list].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return {
    stats,
    employers,
    byId: Object.fromEntries(employers.map((e) => [e.id, e])),
    regions,
    regionById: Object.fromEntries(regions.map((r) => [r.region_id, r])),
    asOf: stats.as_of ? new Date(stats.as_of) : new Date(),
  }
}
