import { matchPath, useLocation } from 'react-router'

export type PageContext = { label: string; section: Section; companyId?: number }

export type Section = 'overview' | 'map' | 'companies' | 'vacancies' | 'methodology' | ''

/** What the user is looking at: drives the active nav item, document title and the agent's context. */
export function usePageContext(): PageContext {
  const { pathname, search } = useLocation()
  const coParam = new URLSearchParams(search).get('co')
  const co = coParam ? Number(coParam) : undefined
  if (pathname === '/') return { label: 'Огляд', section: 'overview' }
  if (pathname === '/map') return { label: 'Карта', section: 'map', companyId: co }
  const company = matchPath('/companies/:id/*', pathname)
  if (company) return { label: 'Підприємство', section: 'companies', companyId: Number(company.params.id) }
  if (pathname === '/companies') return { label: 'Каталог підприємств', section: 'companies' }
  if (pathname === '/vacancies/professions') return { label: 'Професії', section: 'vacancies' }
  if (pathname === '/vacancies') return { label: 'Вакансії', section: 'vacancies' }
  if (matchPath('/regions/:id', pathname)) return { label: 'Регіон', section: 'map' }
  if (pathname === '/methodology') return { label: 'Про дані', section: 'methodology' }
  return { label: 'Огляд', section: '' }
}
