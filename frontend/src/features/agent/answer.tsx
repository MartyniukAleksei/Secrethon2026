import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { fmt, money, plural } from '../../domain/format'
import { categoryOf, sourceName } from '../../domain/labels'
import type { Dataset, Employer } from '../../domain/types'
import type { FiltersState } from '../../state/FiltersContext'
import type { AgentAction } from './AgentContext'

export type Answer = { body: ReactNode; sources?: string[]; actions?: AgentAction[] }

type Context = { data: Dataset; filters: FiltersState; companyId?: number }

const empLink = (e: Employer) => <Link to={`/companies/${e.id}`}>{e.name}</Link>

const normalize = (s: string) => s.toLowerCase().replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim()
const STRIP = /^(ао|пао|оао|зао|ооо|фгуп|фгбу|ау|нао|ат|пат|тов)\s+/

function findEmployer(q: string, data: Dataset): Employer | undefined {
  const t = normalize(q)
  // Longest name first so "Завод Тула" beats "Тула".
  return [...data.employers]
    .map((e) => ({ e, key: normalize(e.name).replace(STRIP, '') }))
    .filter(({ key }) => key.length >= 3 && t.includes(key))
    .sort((a, b) => b.key.length - a.key.length)[0]?.e
}

/**
 * Prototype agent: answers by keyword from the same data the pages show.
 * The real agent will call an LLM with the platform API as tools.
 */
export function answer(question: string, { data, filters, companyId }: Context): Answer {
  const t = question.toLowerCase()
  const scoped = data.employers.filter(filters.matches)
  const named = findEmployer(question, data) ?? (companyId != null ? data.byId[companyId] : undefined)

  if (named && /зв.?яз|пов.?яз|постача|холдинг|материн|санкці/.test(t)) {
    return {
      body: (
        <>
          <b>{named.name}</b>
          {named.gur_company_id != null ? (
            <>
              {' '}є в базі ГУР як «{named.gur_name}», санкцій: {named.sanctions_count}. Материнські й дочірні компанії, постачальники й банки
              показані на вкладці «Зв'язки».
            </>
          ) : (
            <> ще не зіставлено з базою ГУР: для зіставлення потрібен ІПН, а {sourceName(named.source)} його не публікує.</>
          )}
        </>
      ),
      sources: ['Портал ГУР «Війна і санкції»'],
      actions: [{ label: "Зв'язки", to: `/companies/${named.id}/chain` }, { label: 'Профіль', to: `/companies/${named.id}` }],
    }
  }

  if (named) {
    return {
      body: (
        <>
          <b>{named.name}</b> ({[named.locality, named.region].filter(Boolean).join(', ') || 'місто не вказано'}):{' '}
          {fmt(named.vpk_vacancies)} {plural(named.vpk_vacancies, 'вакансія', 'вакансії', 'вакансій')} ВПК, з них підтверджено{' '}
          {fmt(named.confirmed_vacancies)}. Медіана зарплати {money(named.median_salary)}, нових за 30 днів: {fmt(named.new_30d)}. Напрям:{' '}
          {categoryOf(named.category).name.toLowerCase()}.
          {named.sanctions_count > 0 ? ` Під санкціями (${named.sanctions_count}).` : ''}
        </>
      ),
      sources: [sourceName(named.source), ...(named.gur_company_id != null ? ['Портал ГУР'] : [])],
      actions: [
        { label: 'Профіль', to: `/companies/${named.id}` },
        { label: 'Вакансії', to: `/companies/${named.id}/vacancies` },
      ],
    }
  }

  if (/зарплат|зп|медіан|платять|гроші/.test(t)) {
    const top = scoped
      .filter((e) => e.median_salary != null && e.vpk_vacancies >= 10)
      .sort((a, b) => (b.median_salary ?? 0) - (a.median_salary ?? 0))
      .slice(0, 5)
    return {
      body: (
        <>
          Медіана зарплати у вакансіях ВПК: {money(data.stats.median_salary)}. Найвища серед роботодавців із 10+ вакансіями
          {filters.region.length ? ' у вибраному регіоні' : ''}:
          <ul>
            {top.map((e) => (
              <li key={e.id}>
                {empLink(e)}: {money(e.median_salary)}
              </li>
            ))}
          </ul>
          Рахую лише вакансії з місячною зарплатою в рублях.
        </>
      ),
      sources: ['hh.ru', 'Работа России'],
      actions: [{ label: 'Професії', to: '/vacancies/professions' }],
    }
  }

  if (/регіон|област|де найбільш|де наймають/.test(t)) {
    const top = data.stats.regions_list.slice(0, 5)
    return {
      body: (
        <>
          Найбільше вакансій ВПК:
          <ul>
            {top.map((r) => (
              <li key={r.region_id}>
                <Link to={`/regions/${r.region_id}`}>{r.name}</Link>: {fmt(r.vpk_vacancies)} вакансій, {fmt(r.employers)} роботодавців
              </li>
            ))}
          </ul>
        </>
      ),
      sources: ['hh.ru', 'Работа России'],
      actions: [{ label: 'Карта', to: '/map' }],
    }
  }

  if (/санкці/.test(t)) {
    const top = scoped.filter((e) => e.sanctions_count > 0).slice(0, 5)
    return {
      body: (
        <>
          Під санкціями {fmt(data.employers.filter((e) => e.sanctions_count > 0).length)} роботодавців з вакансіями ВПК. Найбільше наймають:
          <ul>
            {top.map((e) => (
              <li key={e.id}>
                {empLink(e)}: {fmt(e.vpk_vacancies)} вакансій, санкцій {e.sanctions_count}
              </li>
            ))}
          </ul>
        </>
      ),
      sources: ['Портал ГУР «Війна і санкції»'],
      actions: [{ label: 'Підприємства', to: '/companies' }],
    }
  }

  const top = scoped.slice(0, 5)
  return {
    body: (
      <>
        {filters.active ? 'За вибраними фільтрами' : 'Загалом'} {fmt(scoped.length)}{' '}
        {plural(scoped.length, 'роботодавець', 'роботодавці', 'роботодавців')} з вакансіями ВПК. Найбільше наймають:
        <ul>
          {top.map((e) => (
            <li key={e.id}>
              {empLink(e)}: {fmt(e.vpk_vacancies)}
            </li>
          ))}
        </ul>
        Можу розповісти про конкретне підприємство, зарплати, регіони чи санкції.
      </>
    ),
    sources: ['hh.ru', 'Работа России'],
    actions: [{ label: 'Підприємства', to: '/companies' }],
  }
}
