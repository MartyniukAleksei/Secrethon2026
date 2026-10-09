import { useEffect, useState } from 'react'
import { AgentAnswer } from './AgentAnswer'
import { ResearchDraft } from './ResearchDraft'
import { deleteResearch, exportResearch, readResearch } from './research'

export function ResearchLibrary() {
  const [records, setRecords] = useState(readResearch)
  const [opened, setOpened] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const refresh = () => setRecords(readResearch())
    window.addEventListener('research-updated', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('research-updated', refresh); window.removeEventListener('storage', refresh) }
  }, [])
  return <div className="ag-library">
    <p>Схвалені дослідження на цьому пристрої. Чернетки сюди не потрапляють. Для резервної копії експортуй файл.</p>
    {!records.length && <div className="ag-empty">Ще немає досліджень. Отримай відповідь і натисни «Переглянути перед збереженням».</div>}
    {records.map(record => <article className="ag-library-card" key={record.id}>
      <button className="ag-library-title" type="button" aria-expanded={opened === record.id} onClick={() => setOpened(id => id === record.id ? null : record.id)}>{record.title}</button>
      <small>Схвалено {new Date(record.approved_at).toLocaleString('uk-UA')}{record.parent_id && ' · нова версія'}</small>
      {opened === record.id && <><p className="ag-original-question">{record.question}</p><AgentAnswer response={record.response} />
        <div className="ag-actions"><button className="btn btn-sm" type="button" onClick={() => exportResearch(record)}>Експорт .md</button><button className="btn btn-sm" type="button" onClick={() => setEditing(record.id)}>Створити нову версію</button><button className="btn btn-sm" type="button" onClick={() => { try { deleteResearch(record.id); setOpened(null); setError('') } catch { setError('Не вдалося видалити дослідження.') } }}>Видалити</button></div>
        {editing === record.id && <ResearchDraft response={record.response} question={record.question} context={record.context} parentId={record.id} />}
      </>}
    </article>)}
    {error && <p role="alert">{error}</p>}
  </div>
}
