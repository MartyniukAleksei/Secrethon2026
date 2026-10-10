import { useEffect, useState } from 'react'
import { AgentAnswer } from './AgentAnswer'
import { ResearchDraft } from './ResearchDraft'
import { deleteResearch, exportResearch, readResearch, readDatabaseResearch, type Research } from './research'
import { useAgent } from './AgentContext'

export function ResearchLibrary() {
  const agent = useAgent()
  const [records, setRecords] = useState(readResearch)
  const [databaseRecords, setDatabaseRecords] = useState<Research[]>([])
  const [opened, setOpened] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    const refresh = () => {
      setRecords(readResearch())
      void readDatabaseResearch().then(values => { if (!disposed) { setDatabaseRecords(values); setError('') } })
        .catch(e => { if (!disposed) setError(e instanceof Error ? e.message : 'БД недоступна.') })
    }
    refresh()
    window.addEventListener('research-updated', refresh)
    window.addEventListener('storage', refresh)
    return () => { disposed = true; window.removeEventListener('research-updated', refresh); window.removeEventListener('storage', refresh) }
  }, [])
  return <div className="ag-library">
    <p>Схвалені дослідження з БД і цього пристрою. Чернетки сюди не потрапляють.</p>
    {!records.length && !databaseRecords.length && <div className="ag-empty">Ще немає досліджень. Отримай відповідь і натисни «Переглянути перед збереженням».</div>}
    {[...databaseRecords, ...records.filter(record => !databaseRecords.some(saved => saved.id === record.id))].map(record => <article className="ag-library-card" key={record.id}>
      <button className="ag-library-title" type="button" aria-expanded={opened === record.id} onClick={() => setOpened(id => id === record.id ? null : record.id)}>{record.title}</button>
      <small>{record.storage === 'database' ? 'Збережено в БД' : 'На цьому пристрої'} · Схвалено {new Date(record.approved_at).toLocaleString('uk-UA')}{record.parent_id && ' · нова версія'}</small>
      {opened === record.id && <><p className="ag-original-question">{record.question}</p><AgentAnswer response={record.response} />
        <div className="ag-actions"><button className="btn btn-sm" type="button" onClick={() => { agent.rememberResearch(record); agent.setPanelTab('chat') }}>Додати до контексту чату</button><button className="btn btn-sm" type="button" onClick={() => exportResearch(record)}>Експорт .md</button><button className="btn btn-sm" type="button" onClick={() => setEditing(record.id)}>Створити нову версію</button>{record.storage !== 'database' && <button className="btn btn-sm" type="button" onClick={() => { try { deleteResearch(record.id); setOpened(null); setError('') } catch { setError('Не вдалося видалити дослідження.') } }}>Видалити</button>}</div>
        {editing === record.id && <ResearchDraft response={record.response} question={record.question} context={record.context} parentId={record.id} onRemember={agent.rememberResearch} />}
      </>}
    </article>)}
    {error && <p role="alert">{error}</p>}
  </div>
}
