import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { usePageContext } from '../../app/pageContext'
import { useData } from '../../data/DataContext'
import { DOMAINS, FOCUS, ROLES } from '../../domain/labels'
import { useFilters } from '../../state/FiltersContext'
import { Icon } from '../../ui/Icon'
import { useAgent } from './AgentContext'
import './AgentPanel.css'
import { ResearchLibrary } from './ResearchLibrary'

const SUGGESTIONS = ['Хто найбільше наймає?', 'Де найвищі зарплати?', 'У яких регіонах найбільше вакансій?', 'Хто з роботодавців під санкціями?']

export function AgentPanel() {
  const { isOpen, messages, typing, webPermission, chooseWebAccess, startNewChat, close, ask, target, setTarget, mapView, comparisonIds, toggleComparison, panelTab: tab, setPanelTab: setTab } = useAgent()
  const { byId, regionById } = useData()
  const filters = useFilters()
  const page = usePageContext()
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && tab === 'chat') input.current?.focus()
  }, [isOpen, tab])
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages, typing, tab, webPermission])

  if (!isOpen) return null

  const company = page.companyId ? byId[page.companyId] : undefined
  const names = (values: string[], of: (v: string) => string | undefined) => values.map((v) => of(v) ?? v).join(' / ')
  const scope = [
    filters.focus.length ? `Фокус: ${names(filters.focus, (v) => FOCUS[v as keyof typeof FOCUS])}` : '',
    names(filters.domain, (v) => DOMAINS[v]),
    names(filters.role, (v) => ROLES[v]),
    names(filters.region, (v) => (v === 'none' ? 'без регіону' : regionById[Number(v)]?.name)),
    filters.days ? `за ${filters.days} днів` : '',
  ]
    .filter(Boolean)
    .join(', ')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || typing || webPermission) return
    ask(text)
    setText('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }
  const newChat = () => {
    setText('')
    startNewChat()
    requestAnimationFrame(() => {
      if (input.current) {
        input.current.style.height = 'auto'
        input.current.focus()
      }
    })
  }

  return (
    <aside className="agent" aria-label="AI-агент">
      <div className="ag-head">
        <div className="t">
          <b>
            <Icon name="spark" />
            {tab === 'chat' ? 'Агент' : 'Збережені дослідження'}
          </b>
          <span>{tab === 'chat' ? 'Відповідає з наших даних і показує джерела' : 'Схвалені відповіді та джерела на цьому пристрої'}</span>
        </div>
        <button className="btn btn-ghost btn-sm ag-new-chat" type="button" title="Почати новий чат" onClick={newChat}>Новий чат</button>
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={tab === 'chat' ? 'Збережені дослідження' : 'Повернутися до чату'} title={tab === 'chat' ? 'Збережені дослідження' : 'Повернутися до чату'} onClick={() => setTab(tab === 'chat' ? 'research' : 'chat')}>
          <Icon name={tab === 'chat' ? 'bookmark' : 'chev'} className={tab === 'research' ? 'ag-back' : undefined} />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Закрити агента" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      {tab === 'chat' && <div className="ag-ctx">
        Бачу: <span className="badge">{page.section === 'map' && target !== 'company' ? target === 'viewport' ? 'Видима область карти' : target === 'selection' ? 'Вибрані підприємства' : 'Поточні фільтри карти' : company ? company.name : page.label}</span>
        {scope && <span className="badge">{scope}</span>}
        {page.section === 'map' && <details className="ag-context-tools"><summary>Контекст і швидкі запити<Icon name="chev" /></summary><div className="ag-context-body"><label className="ag-target-label">Запитання про<select aria-label="Область запитання" value={target} onChange={e => setTarget(e.target.value as typeof target)}>
          <option value="company">{company ? company.name : 'Підприємство / загальне питання'}</option>
          <option value="viewport" disabled={!mapView?.bounds}>Видиму область карти</option>
          <option value="filters">Усі підприємства за фільтрами</option>
          <option value="selection" disabled={!comparisonIds.length}>Вибрані для порівняння ({comparisonIds.length})</option>
        </select></label>
        {target === 'viewport' && <small>{mapView?.visible_count ?? 0} підприємств із місцями найму у видимій області. Аналітика області враховує координати вакансій. Область фіксується при надсиланні питання.</small>}
        <details className="ag-map-tools" open>
          <summary>Швидкі запити та порівняння</summary>
          <div className="ag-map-quick">
            {(target === 'viewport' || target === 'filters') && <button className="chip" type="button" disabled={typing || target === 'viewport' && !mapView?.bounds} onClick={() => ask('Підсумуй цю вибірку: кількість підприємств, вакансії, зарплати та топ-10 за наймом. Вкажи охоплення й джерела.', { target })}>{target === 'viewport' ? 'Огляд області' : 'Огляд вибірки'}</button>}
            {company && target === 'company' && <>
              <button className="chip" type="button" disabled={typing} onClick={() => ask('Що відомо про це підприємство: діяльність, вакансії, зарплати та санкції? Покажи джерела.', { target: 'company', companyId: company.id })}>Профіль і показники</button>
              <button className="chip" type="button" disabled={typing} onClick={() => ask('Покажи відомі зв’язки цього підприємства з доказами.', { target: 'company', companyId: company.id })}>Зв’язки</button>
              <button className="chip" type="button" disabled={typing} onClick={() => ask('Знайди публічні згадки цього підприємства за останні 7 днів. Відділи їх від даних платформи та додай джерела.', { target: 'company', companyId: company.id })}>Свіжі згадки</button>
            </>}
            {company && <button className="chip" type="button" aria-pressed={comparisonIds.includes(company.id)} disabled={!comparisonIds.includes(company.id) && comparisonIds.length >= 5} onClick={() => toggleComparison(company.id)}>{comparisonIds.includes(company.id) ? 'Прибрати з порівняння' : 'Додати до порівняння'}</button>}
            {comparisonIds.length > 0 && <button className="chip" type="button" disabled={typing} onClick={() => ask('Порівняй вибрані підприємства за кількістю вакансій та медіанною зарплатою. Додай таблицю і джерела.', { target: 'selection' })}>Порівняти ({comparisonIds.length}/5)</button>}
          </div>
          {comparisonIds.length > 0 && <div className="ag-selected-companies">{comparisonIds.map(id => <button type="button" className="chip" key={id} onClick={() => toggleComparison(id)}>{byId[id]?.name ?? id} ×</button>)}</div>}
        </details>
        </div></details>}
      </div>}
      {tab === 'research' ? <div className="ag-msgs"><ResearchLibrary /></div> : <><div className="ag-msgs" ref={list} aria-live="polite">
        <div className="msg bot">
          Привіт. Я відповідаю на питання про найм і ланцюги постачання ВПК РФ і бачу сторінку, на якій ти зараз. Можу пояснити цифри,
          знайти підприємство або відкрити потрібний розділ.
          {messages.length === 0 && (
            <div className="ag-sugg">
              {(page.section === 'map' ? target === 'viewport' || target === 'filters' ? ['Підсумуй цю вибірку: скільки підприємств і вакансій?', 'Покажи топ-10 підприємств за наймом у цій вибірці', 'Яка медіанна зарплата в цій вибірці?'] : target === 'selection' ? ['Порівняй вибрані підприємства за вакансіями й зарплатами', 'Покажи таблицю вакансій вибраних підприємств'] : company ? ['Що відомо про це підприємство?', 'Покажи його зв’язки з джерелами', 'Знайди публічні згадки за останні 7 днів'] : SUGGESTIONS : SUGGESTIONS).map((q) => (
                <button key={q} className="chip" type="button" disabled={typing} onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.body}
            {m.sources && m.sources.length > 0 && (
              <div className="srcs">
                {m.sources.map((s) => (
                  <span key={s}>
                    <Icon name="doc" />
                    {s}
                  </span>
                ))}
              </div>
            )}
            {m.actions && (
              <div className="acts">
                {m.actions.map((a) => (
                  <Link key={a.to} className="btn btn-sm" to={a.to}>
                    {a.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
        {webPermission && <div className="msg bot ag-web-consent" role="group" aria-label="Дозвіл на пошук в інтернеті">
          <b>Де шукати інформацію?</b>
          <p>Шукати інформацію про «{webPermission.company}» у базі чи доповнити її відкритими джерелами за останні {webPermission.days} днів?</p>
          <div className="ag-consent-actions">
            <button type="button" className="btn btn-sm" disabled={typing} onClick={() => chooseWebAccess('db_only')}>Шукати в базі</button>
            <button type="button" className="btn btn-sm" disabled={typing} onClick={() => chooseWebAccess('allowed')}>Шукати в базі та інтернеті</button>
          </div>
          <small>Дозвіл діє лише для цього запитання.</small>
        </div>}
        {typing && (
          <div className="msg bot typing-msg">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      <form className="ag-input" onSubmit={submit}>
        <label className="sr" htmlFor="agText">
          Питання агенту
        </label>
        <textarea
          id="agText"
          ref={input}
          maxLength={4000}
          disabled={!!webPermission}
          rows={1}
          value={text}
          placeholder="Питання про підприємство чи регіон"
          onChange={(e) => {
            setText(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`
          }}
          onKeyDown={onKeyDown}
        />
        <button className="btn btn-primary btn-icon" type="submit" aria-label="Надіслати" disabled={typing || !!webPermission || !text.trim()}>
          <Icon name="send" />
        </button>
      </form>
      </>}
      <p className="ag-note">Відповіді на основі бази та публічних джерел. Перевіряйте джерела; висновки агента можуть містити помилки.</p>
    </aside>
  )
}
