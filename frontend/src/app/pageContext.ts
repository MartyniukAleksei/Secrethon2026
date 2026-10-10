import { createContext, useContext, useEffect } from 'react'
import { matchPath, useLocation } from 'react-router'

export type PageContext = { label: string; section: Section; companyId?: number }

export type Section = 'overview' | 'map' | 'companies' | 'rating' | 'vacancies' | 'methodology' | 'opendata' | ''

/** What the user is looking at: drives the active nav item, document title and the agent's context. */
export function usePageContext(): PageContext {
  const { pathname, search } = useLocation()
  const coParam = new URLSearchParams(search).get('co')
  const co = coParam ? Number(coParam) : undefined
  if (pathname === '/') return { label: 'Огляд', section: 'overview' }
  if (pathname === '/map') return { label: 'Карта', section: 'map', companyId: co }
  const company = matchPath('/companies/:id/*', pathname)
  if (company) return { label: 'Підприємство', section: 'companies', companyId: Number(company.params.id) }
  if (matchPath('/enterprises/:id', pathname)) return { label: 'Юрособа', section: 'rating' }
  if (pathname === '/rating') return { label: 'Рейтинг важливості', section: 'rating' }
  if (pathname === '/companies') return { label: 'Каталог підприємств', section: 'companies' }
  if (pathname === '/vacancies/professions') return { label: 'Професії', section: 'vacancies' }
  if (pathname === '/vacancies') return { label: 'Вакансії', section: 'vacancies' }
  if (matchPath('/vacancies/:id', pathname)) return { label: 'Вакансія', section: 'vacancies' }
  if (matchPath('/regions/:id', pathname)) return { label: 'Регіон', section: 'map' }
  if (pathname === '/methodology') return { label: 'Про дані', section: 'methodology' }
  if (pathname === '/open-data') return { label: 'Відкриті дані', section: 'opendata' }
  return { label: 'Сторінку не знайдено', section: '' }
}

/** Lets a page name the browser tab after what it shows (a vacancy, a region, «not found»). */
export const PageTitleContext = createContext<(title: string | null) => void>(() => {})

/** Sets the tab title while the page is shown; `null` leaves the default. */
export function usePageTitle(title: string | null | undefined) {
  const set = useContext(PageTitleContext)
  useEffect(() => {
    if (title == null) return
    set(title)
    return () => set(null)
  }, [title, set])
}
