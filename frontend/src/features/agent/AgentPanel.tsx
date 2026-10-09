import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { usePageContext } from '../../app/pageContext'
import { useData } from '../../data/DataContext'
import { DOMAINS, FOCUS, ROLES } from '../../domain/labels'
import { useFilters } from '../../state/FiltersContext'
import { Icon } from '../../ui/Icon'
import { useAgent } from './AgentContext'
import './AgentPanel.css'

const SUGGESTIONS = ['Хто найбільше наймає?', 'Де найвищі зарплати?', 'У яких регіонах найбільше вакансій?', 'Хто з роботодавців під санкціями?']

type Props = {
  fullscreen: boolean
  onToggleFullscreen: () => void
  onClose: () => void
}

export function AgentPanel({ fullscreen, onToggleFullscreen, onClose }: Props) {
  const { isOpen, messages, typing, ask } = useAgent()
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
  useEffect(() => {
    const textarea = input.current
    if (!textarea || !isOpen) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(140, textarea.scrollHeight + 2)}px`
  }, [text, fullscreen, isOpen])

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
    if (!text.trim() || typing) return
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
    <aside id="agent-panel" className={`agent${fullscreen ? ' ag-fullscreen' : ''}`} aria-label="AI-агент"
      onClickCapture={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null
        const href = link?.getAttribute('href')
        if (!href?.startsWith('/') || href.startsWith('//')) return
        // Show the destination rather than leaving it behind the agent overlay.
        if (window.innerWidth <= 900) onClose()
        else if (fullscreen) onToggleFullscreen()
      }}>
      <div className="ag-head">
        <b>
          <Icon name="spark" />
          Агент
        </b>
        <span className="ag-subtitle">Відповідає з наших даних і показує джерела</span>
        <div className="ag-head-actions">
          <button
            className="btn btn-secondary btn-sm ag-fullscreen-btn"
            type="button"
            aria-label={fullscreen ? 'Згорнути агента' : 'Відкрити агента на весь екран'}
            aria-controls="agent-panel"
            title={fullscreen ? 'Згорнути агента (Esc)' : 'Відкрити агента на весь екран'}
            onClick={onToggleFullscreen}
          >
            <Icon name={fullscreen ? 'collapse' : 'expand'} />
            {fullscreen ? 'Згорнути' : 'На весь екран'}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Закрити агента" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="ag-ctx">
        Бачу: <span className="badge">{company ? company.name : page.label}</span>
        {scope && <span className="badge">{scope}</span>}
      </div>
      <div className="ag-msgs" ref={list} aria-live="polite">
        <div className="msg bot">
          Привіт. Я відповідаю на питання про найм і ланцюги постачання ВПК РФ і бачу сторінку, на якій ти зараз. Можу пояснити цифри,
          знайти підприємство або відкрити потрібний розділ.
          {messages.length === 0 && (
            <div className="ag-sugg">
              {SUGGESTIONS.map((q) => (
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
          rows={1}
          value={text}
          placeholder="Питання про підприємство чи регіон"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn btn-primary btn-icon" type="submit" aria-label="Надіслати" disabled={typing || !text.trim()}>
          <Icon name="send" />
        </button>
      </form>
      <p className="ag-note">Відповіді на основі бази та публічних джерел. Перевіряйте джерела; висновки агента можуть містити помилки.</p>
    </aside>
  )
}
