import type { MapAction } from './types'

/** Routes contain only verified card IDs; no model-provided URL is executed. */
export function mapActionHref(action: MapAction): string {
  const params = new URLSearchParams({ co: String(action.employer_id) })
  if (action.kind === 'show_hiring_places' && action.places?.length) {
    params.set('hiring_places', JSON.stringify(action.places))
    params.set('agent_ids', (action.employer_ids ?? [action.employer_id]).join(','))
  }
  if (action.kind === 'show_relations') {
    params.set('layers', 'supplier,parent')
    params.set('network', '1')
    params.set('network_other', '1')
  }
  return `/map?${params}`
}
