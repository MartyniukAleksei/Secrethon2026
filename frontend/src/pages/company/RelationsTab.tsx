import { RelationRows } from '../../components/RelationRows'
import type { ApiRelation } from '../../api/types'
import type { TabProps } from './CompanyPage'

const GROUPS: { title: string; test: (r: ApiRelation) => boolean }[] = [
  { title: 'Структура холдингу', test: (r) => r.kind === 'parent' || r.kind === 'successor' },
  { title: 'Постачання', test: (r) => r.kind === 'supplier' },
  { title: 'Банки', test: (r) => r.kind === 'bank' },
  { title: "Інші зв'язки", test: (r) => r.kind === 'related' },
]

export function RelationsTab({ employer: e }: TabProps) {
  const gur = e.gur
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>Зв'язки з іншими підприємствами</h3>
          <p>З бази ГУР «Війна і санкції»: материнські й дочірні компанії, постачальники, банки.</p>
        </div>
      </div>
      {!gur ? (
        <p className="empty-row">Роботодавця ще не зіставлено з карткою ГУР, тому зв'язків немає. Зіставляємо за ІПН.</p>
      ) : gur.relations.length === 0 ? (
        <p className="empty-row">У картці ГУР зв'язків не вказано.</p>
      ) : (
        <div className="relation-groups">
          {GROUPS.map((g) => {
            const items = gur.relations.filter(g.test)
            return items.length ? (
              <div key={g.title} className="card">
                <h4 className="chain-col-title">{g.title}</h4>
                <RelationRows relations={items} />
              </div>
            ) : null
          })}
        </div>
      )}
    </div>
  )
}
