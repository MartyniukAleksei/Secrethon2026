import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { usePageContext } from '../../app/pageContext'
import { useData } from '../../data/DataContext'
import { categoryOf } from '../../domain/labels'
import { useFilters } from '../../state/FiltersContext'
import { Icon } from '../../ui/Icon'
import { useAgent } from './AgentContext'
import './AgentPanel.css'

const SUGGESTIONS = ['Хто найбільше наймає?', 'Де найвищі зарплати?', 'У яких регіонах найбільше вакансій?', 'Хто з роботодавців під санкціями?']

export function AgentPanel() {
  const { isOpen, messages, typing, close, ask } = useAgent()
  const { byId, regionById } = useData()
  const filters = useFilters()
  const page = usePageContext()
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) input.current?.focus()
  }, [isOpen])
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages, typing])

  if (!isOpen) return null

  const company = page.companyId ? byId[page.companyId] : undefined
  const scope = [
    filters.category !== 'all' ? categoryOf(filters.category).name : '',
    filters.region !== 'all' ? regionById[filters.region]?.name : '',
    filters.periodName,
  ]
    .filter(Boolean)
    .join(', ')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    ask(text)
    setText('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <aside className="agent" aria-label="AI-агент">
      <div className="ag-head">
        <div className="t">
          <b>
            <Icon name="spark" />
            Агент
          </b>
          <span>Відповідає з наших даних і показує джерела</span>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Закрити агента" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="ag-ctx">
        Бачу: <span className="badge">{company ? company.name : page.label}</span>
        <span className="badge">{scope}</span>
      </div>
      <div className="ag-msgs" ref={list} aria-live="polite">
        <div className="msg bot">
          Привіт. Я відповідаю на питання про найм і ланцюги постачання ВПК РФ і бачу сторінку, на якій ти зараз. Можу пояснити цифри,
          знайти підприємство або відкрити потрібний розділ.
          {messages.length === 0 && (
            <div className="ag-sugg">
              {SUGGESTIONS.map((q) => (
                <button key={q} className="chip" type="button" onClick={() => ask(q)}>
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
        <button className="btn btn-primary btn-icon" type="submit" aria-label="Надіслати">
          <Icon name="send" />
        </button>
      </form>
      <p className="ag-note">Поки агент відповідає за ключовими словами з даних платформи. Справжній агент на моделі підключається до того ж API.</p>
    </aside>
  )
}
