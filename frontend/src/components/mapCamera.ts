import type { ApiMapPoint, ApiMapSite } from '../api/types'

/** Focus a company on its registered head office, rather than all its hiring cities. */
export function companyLocation(points: ApiMapPoint[], sites: ApiMapSite[], selectedId?: number) {
  if (selectedId == null) return undefined
  const ownSites = sites.filter(site => site.employer_id === selectedId)
  const head = ownSites.find(site => site.kind === 'head_office')
  if (head) return head
  const hiring = points.filter(point => point.employer_id === selectedId)
    .sort((a, b) => b.vacancies - a.vacancies)[0]
  return hiring ?? ownSites[0]
}

/** Keep the camera's target in the part of the map left visible by the company card. */
export function cameraPadding(container: HTMLElement) {
  const rect = container.getBoundingClientRect()
  const padding = { top: Math.min(80, rect.height / 5), bottom: Math.min(100, rect.height / 5), left: Math.min(50, rect.width / 8), right: Math.min(50, rect.width / 8) }
  const card = container.querySelector<HTMLElement>('.map-pop')?.getBoundingClientRect()
  if (card) {
    if (card.width > rect.width * 0.75) padding.bottom = Math.min(rect.bottom - card.top + 16, rect.height - padding.top - 140)
    else padding.right = Math.min(rect.right - card.left + 16, rect.width - padding.left - 140)
  }
  return padding
}
