import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import type { ApiMethodology, ApiStats } from '../api/types'
import { ClassificationFlow } from '../components/ClassificationFlow'
import { DiscoveryLog } from '../components/DiscoveryLog'
import { useData } from '../data/DataContext'
import { useApi } from '../data/useApi'
import { fmt, longDate } from '../domain/format'
import { DISCOVERY_STATUS, FOCUS, PROVIDERS, sourceName, VPK_CATEGORY } from '../domain/labels'
import { Dedup } from './OverviewPage'
import './MethodologyPage.css'

const SECTIONS = [
  ['sources', 'Джерела, зіставлення, дублі'],
  ['flow', 'Як класифікуємо'],
  ['classes', 'Класи'],
  ['verification', 'Перевірка'],
  ['mcp', 'MCP'],
  ['search', 'Як ми шукали'],
  ['limits', 'Обмеження'],
] as const

/** What each company class means, in the order of the table. */
const COMPANY_CLASSES: [string, string][] = [
  ['vpk', 'Російська організація, яка розробляє, виробляє, ремонтує чи випробовує озброєння, військову техніку, їхні компоненти або працює за держоборонзамовленням.'],
  ['agency_vpk', 'Кадрове агентство чи аутстафінг, що набирає людей для підприємств ВПК. Саме підприємством ВПК не є; його вакансії рахуємо окремо.'],
  ['foreign_intermediary', 'Іноземна компанія, пов’язана з рф або її війною: постачає товари й компоненти, допомагає обходити санкції, бере участь у виробництві зброї, яку отримує рф.'],
  ['civil_sanctioned', 'Російська організація під санкціями з цивільною діяльністю без ознак військової продукції: банк, зв’язок, видобуток, торгівля.'],
  ['foreign_other', 'Іноземна компанія, чиї санкції й діяльність за фактами не пов’язані з рф (наприклад, іранська нафтохімія).'],
  ['out', 'Цивільна компанія без санкцій і без ознак зв’язку з ВПК.'],
  ['unknown', 'Фактів замало, щоб обрати клас: відомі лише назва, країна і, можливо, факт санкцій.'],
]

const VACANCY_CLASSES: Record<string, string> = {
  'vpk/confirmed': 'Вакансія підприємства ВПК, рішення прийнято',
  'vpk/likely': 'Вакансія ВПК на перевірці',
  'agency/confirmed': 'Кадрове агентство набирає у ВПК',
  'agency/likely': 'Кадрове агентство для ВПК, на перевірці',
  'vpk/no': 'Ознаки ВПК не підтвердилися, не показуємо',
  'agency/no': 'Агентство без підтвердженого зв’язку з ВПК, не показуємо',
  'excluded/no': 'Цивільна, санкційна цивільна чи іноземна компанія, не показуємо',
}

const FOCUS_BASIS: Record<string, string> = {
  gur_weapon: 'кооперація з виробництва озброєння (ГУР)',
  gur_uav: 'моделі БпЛА в базі ГУР',
  gur_component: 'компоненти озброєння (ГУР)',
  jev_direction: 'напрям діяльності за JEV',
  vacancies: 'згадки у вакансіях',
  jev_focus: 'окреме питання до JEV',
}

const STRATA: Record<string, string> = {
  'vpk/decided': 'ВПК, рішення прийнято',
  'vpk/review': 'ВПК, на перевірці',
  agency_vpk: 'Кадрове агентство для ВПК',
  civil_sanctioned: 'Цивільна під санкціями',
  foreign_intermediary: 'Іноземний посередник',
  foreign_other: 'Іноземна, не пов’язана з рф',
  'out/jev': 'Не ВПК (рішення JEV)',
  'out/rule': 'Не ВПК (за правилом)',
  unknown: 'Недостатньо даних',
  'vpk/company': 'Вакансія: ВПК за підприємством',
  'vpk/company_review': 'Вакансія: підприємство на перевірці',
  'vpk/text': 'Вакансія: ВПК за текстом',
  agency: 'Вакансія кадрового агентства',
  'excluded/company': 'Вакансія: виключено за підприємством',
  'no/text': 'Вакансія: не ВПК за текстом',
}

const JUDGE_LABELS: Record<string, string> = {
  ...VPK_CATEGORY,
  not_vpk: 'Не ВПК',
  unclear: 'Неясно',
}

const MATCH_KINDS: Record<string, string> = {
  auto: 'за ІПН (сайт вакансій або сайт роботодавця)',
  verified: 'перевірено вручну',
  candidate_sure: 'за назвою й регіоном, упевненість ≥ 0,8 — вважаємо зв’язком',
  candidate_weak: 'слабкий збіг за назвою — не використовуємо',
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—')

export function MethodologyPage() {
  const { stats } = useData()
  const m = useApi('methodology', (signal) => api.methodology(signal))
  const data = m.status === 'ready' ? m.data : undefined
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Про дані</h1>
          <p>Звідки беруться дані, як ми визначаємо дотичність до ВПК, які є класи, як перевіряємо рішення і як підключитися до даних через MCP.</p>
        </div>
      </div>
      <nav className="method-toc" aria-label="Розділи">
        {SECTIONS.map(([id, title]) => (
          <a key={id} href={`#${id}`}>
            {title}
          </a>
        ))}
      </nav>
      <div className="method">
        <Sources stats={stats} data={data} />
        <Flow stats={stats} />
        {data ? <Classes data={data} /> : <div className="skeleton method-skeleton" />}
        {data ? <Verification data={data} /> : <div className="skeleton method-skeleton" />}
        {data ? <Mcp mcp={data.mcp} /> : <div className="skeleton method-skeleton" />}
        <section className="panel" id="search">
          <h3>Як ми шукали</h3>
          <p>Що шукали у відкритих джерелах про кожне підприємство і що з цього стало перевіреним фактом чи контактом.</p>
          <DiscoverySummary />
          <DiscoveryLog />
        </section>
        <Limits />
      </div>
    </>
  )
}

function Sources({ stats, data }: { stats: ApiStats; data?: ApiMethodology }) {
  const d = data?.dedup
  return (
    <section className="panel" id="sources">
      <h3>Звідки дані</h3>
      <ul>
        {stats.by_source.map((s) => (
          <li key={s.source}>
            <b>{sourceName(s.source)}:</b> {fmt(s.vacancies)} активних вакансій, з них {fmt(s.vpk_vacancies)} віднесено до ВПК.
          </li>
        ))}
        <li>
          <b>Портал ГУР «Війна і санкції»:</b> {fmt(stats.gur_companies)} підприємств із реквізитами, описами, продукцією, санкціями ({fmt(stats.sanctioned_companies)}{' '}
          під санкціями) і {fmt(stats.company_relations)} зв'язками між ними.
        </li>
        <li>
          <b>Реєстри:</b> ЄДРЮЛ (ФНС) і DaData — ІПН, ОГРН, ОКВЕД, статус, адреса, керівник юрособи.
        </li>
        <li>
          <b>OpenSanctions:</b> санкційні списки світу з підставами; зіставляємо за ІПН, іноземні компанії — за назвою й псевдонімами.
        </li>
        <li>
          <b>Відкриті джерела:</b> вебпошук Exa для підприємств без опису ГУР — сайти компаній, реєстри, ЗМІ (див. «Як ми шукали»).
        </li>
      </ul>
      <p className="method-note">Дані станом на {stats.as_of ? longDate(stats.as_of) : '—'}; збираємо лише відкриті джерела: без входу під обліковими записами, без обходу авторизації, без злитих баз.</p>

      <h4>Як зіставляли роботодавців з юрособами</h4>
      <p>
        «Работа России» і SuperJob показують ІПН роботодавця — зв’язок за ним автоматичний. hh.ru ІПН не показує, тому юрособу шукаємо за правилами, від
        надійнішого до слабшого: ІПН на сайті роботодавця (з контрольною сумою), та сама назва в тому самому регіоні в ЄДРЮЛ або DaData, бренд hh цілком
        входить у юридичну назву, єдиний збіг назви з кількох слів в іншому регіоні. Кожен зв’язок має метод і упевненість.
      </p>
      {data && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Зв’язок профілю з юрособою</th>
                <th className="num">Профілів</th>
              </tr>
            </thead>
            <tbody>
              {data.matching.map((r) => (
                <tr key={r.kind}>
                  <td>{MATCH_KINDS[r.kind] ?? r.kind}</td>
                  <td className="num">{fmt(r.profiles)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4>Дедуплікація</h4>
      <ul>
        <li>
          <b>Вакансії:</b> повторна публікація того самого оголошення на одному сайті (той самий текст або схожий на ≥ 80% за словами
          {d && <> — {fmt(d.reposts)}</>}) і та сама вакансія на іншому сайті (те саме підприємство, посада й місто{d && <> — {fmt(d.cross_source)}</>}). Їх не
          показуємо й не рахуємо; у відкритих даних є режим «з дублями», де повтори позначено.
        </li>
        <li>
          <b>Картки:</b> профілі однієї юрособи на різних сайтах вакансій склеєно в одну картку, філії — окремо (той самий філіал на різних сайтах — одна картка).{' '}
          <Dedup stats={stats} />.
        </li>
        <li>
          <b>Компанії:</b> той самий ІПН і ОГРН з поміткою «філія» — філія головної компанії, а не дубль
          {d && <> ({fmt(d.branch_edges)} зв’язків)</>}; без ІПН з однаковою повною назвою — дубль{d && <> ({fmt(d.company_duplicates)})</>}. Сумнівні зв’язки
          (однакова назва, різні ІПН в одному регіоні) нічого не змінюють автоматично — їх перевіряє людина.
        </li>
      </ul>
    </section>
  )
}

function Flow({ stats }: { stats: ApiStats }) {
  return (
    <section className="panel" id="flow">
      <h3>Як класифікуємо</h3>
      <p>
        Класифікуємо <b>підприємство</b>, а не вакансію. Якщо юрособу віднесено до ВПК, показуємо всі її вакансії — і токаря, і бухгалтера, і водія. Текст
        вакансії вирішує лише там, де про підприємство нічого не відомо: кадрові агентства, приховані роботодавці, роботодавці без знайденої юрособи.
      </p>
      <ClassificationFlow />
      <ol className="method-steps">
        <li>
          <b>Ключові слова</b> лише відбирають кандидатів: групи слів («військове приймання», «ДОЗ», «БпЛА»…) мають стояти в одному реченні, не далі 60
          символів одне від одного, інакше «військовий квиток… приймання тесту» дало б «військове приймання». Рішення ключові слова не ухвалюють.
        </li>
        <li>
          <b>Досьє</b> компанії збирається з бази: розділи й опис ГУР, продукція, ОКВЕД і статус з реєстру, санкції ГУР і OpenSanctions, вакансії з ознаками
          ВПК. Для роботодавців без опису ГУР досьє доповнює пошук: <b>Exa</b> знаходить сторінки, модель (<b>Gemini</b> або <b>GPT</b>) виписує факти з
          дослівними цитатами, а скрипт залишає лише факти, чию цитату знайдено в тексті сторінки. Опис на сайті складено лише з таких фактів, з посиланнями [n].
        </li>
        <li>
          <b>JEV</b> — рушій рішень: за досьє він відповідає на три питання (категорія, галузь, роль) і дає розподіл ймовірностей за всіма варіантами, а не
          одну відповідь. Повні розподіли зберігаємо.
        </li>
        <li>
          <b>Правила поверх JEV:</b> мітки, неможливі для країни компанії, прибрано (російська не буває «іноземною», іноземна — «ВПК»); «цивільна під
          санкціями» — лише за наявності санкцій; підприємство з ВПК-розділів ГУР не буває кадровим агентством. Імовірність ≥ 0,9 — «рішення прийнято», нижче —
          «на перевірці». Підприємство ВПК з цивільною галуззю JEV перепитує без цивільних варіантів; якщо оборонного напряму не видно, лишається «на
          перевірці».
        </li>
        <li>
          <b>Підсумкова мітка вакансії</b>: вакансії ВПК-підприємства — ВПК незалежно від тексту; цивільної чи іноземної компанії — не показуємо; без юрособи —
          JEV за текстом вакансії, і лише якщо ключові слова дали сильний сигнал.{' '}
          {stats.final_run_at && <>Оновлено {longDate(stats.final_run_at)}</>}
        </li>
      </ol>
    </section>
  )
}

function Classes({ data }: { data: ApiMethodology }) {
  const companies = new Map<string, { decided: number; review: number }>()
  data.companies.forEach((r) => {
    const c = companies.get(r.category) ?? { decided: 0, review: 0 }
    c[r.level] += r.n
    companies.set(r.category, c)
  })
  const vacancies = new Map(data.vacancies.map((r) => [`${r.category}/${r.level}`, r.n]))
  const focus = new Map<string, number>()
  const focusBasis = new Map<string, Map<string, number>>()
  data.focus.forEach((r) => {
    focus.set(r.focus, (focus.get(r.focus) ?? 0) + r.n)
    const b = focusBasis.get(r.focus) ?? new Map<string, number>()
    b.set(r.basis, r.n)
    focusBasis.set(r.focus, b)
  })
  return (
    <section className="panel" id="classes">
      <h3>Класи</h3>
      <h4>Юрособи: дотичність до ВПК</h4>
      <div className="table-wrap">
        <table className="data method-classes">
          <thead>
            <tr>
              <th>Клас</th>
              <th>Що означає</th>
              <th className="num">Рішення</th>
              <th className="num">На перевірці</th>
            </tr>
          </thead>
          <tbody>
            {COMPANY_CLASSES.map(([key, text]) => (
              <tr key={key}>
                <td>
                  <b>{VPK_CATEGORY[key as keyof typeof VPK_CATEGORY]}</b>
                  <code>{key}</code>
                </td>
                <td className="method-desc">{text}</td>
                <td className="num">{fmt(companies.get(key)?.decided ?? 0)}</td>
                <td className="num">{fmt(companies.get(key)?.review ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="method-note">
        У лічильники підприємств ВПК іде лише «ВПК». Кожна юрособа має ще галузь і роль (наприклад, «Виробництво БпЛА», «Компоненти для ракетно-космічної
        техніки») і надійність за кодом Admiralty: буква — найкраще джерело, на якому стоїть рішення (A — реєстр, санкційний список; B — ГУР, сайт компанії; C —
        вакансії, ЗМІ; F — прямого джерела немає), цифра — узгодженість (1 — кілька незалежних джерел … 4 — сумнівно, 6 — неможливо оцінити).
      </p>

      <h4>Фокус замовника (для підприємств ВПК)</h4>
      <ul>
        {(['drone', 'missile', 'kab'] as const).map((f) => (
          <li key={f}>
            <b>{FOCUS[f]}</b> — {fmt(focus.get(f) ?? 0)}:{' '}
            {f === 'drone' && 'дрони, баражувальні боєприпаси та їхні компоненти. '}
            {f === 'missile' && 'балістичні й крилаті ракети, ОТРК; без зенітних ракет. '}
            {f === 'kab' && 'кориговані й плануючі авіабомби, модулі УМПК, УМПБ. '}
            <span className="method-muted">
              Підстави:{' '}
              {[...(focusBasis.get(f) ?? new Map()).entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([basis, n]) => `${FOCUS_BASIS[basis] ?? basis} ${fmt(n)}`)
                .join(', ')}
              .
            </span>
          </li>
        ))}
        <li>
          <b>{FOCUS.other}</b> — решта підприємств ВПК: бронетехніка, артилерія, флот, авіація, радіоелектроніка без зв’язку з трьома фокусами.
        </li>
      </ul>

      <h4>Вакансії: підсумкова мітка</h4>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Мітка</th>
              <th className="num">Активних вакансій</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(VACANCY_CLASSES).map(([key, label]) => (
              <tr key={key}>
                <td>
                  {label} <code>{key}</code>
                </td>
                <td className="num">{fmt(vacancies.get(key) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Verification({ data }: { data: ApiMethodology }) {
  const { checks: c, judge, human } = data
  const totals = (kind: 'company' | 'vacancy') => {
    const rows = judge?.strata.filter((s) => s.kind === kind) ?? []
    return rows.reduce((a, s) => ({ n: a.n + s.n, agree: a.agree + s.agree, agree_vpk: a.agree_vpk + s.agree_vpk }), { n: 0, agree: 0, agree_vpk: 0 })
  }
  const companies = totals('company')
  const vacancies = totals('vacancy')
  return (
    <section className="panel" id="verification">
      <h3>Як перевіряємо</h3>
      <h4>Скрипти: що не перевірено, того не показуємо</h4>
      <ul>
        <li>
          Факт із пошуку зберігається, лише якщо його дослівну цитату знайдено в тексті сторінки: перевірено {fmt(c.facts_verified)}, відкинуто{' '}
          {fmt(c.facts_rejected)} ({pct(c.facts_rejected, c.facts_verified + c.facts_rejected)}).
        </li>
        <li>
          Контакти: телефон — останні 10 цифр є на сторінці джерела, ІПН — контрольна сума й ІПН на сторінці, керівник — прізвище на сторінці, сайт — відкривається.
          Перевірено {fmt(c.contacts_verified)}, відкинуто {fmt(c.contacts_rejected)}.
        </li>
        <li>Рішення JEV з імовірністю нижче 0,9 не стає «рішенням», а йде «на перевірку»; повні розподіли ймовірностей збережено.</li>
      </ul>

      <h4>LLM as a judge</h4>
      {judge ? (
        <>
          <p>
            Інша модель ({judge.model ?? 'GPT'}, не JEV) наосліп ухвалює рішення заново для стратифікованої вибірки — тих самих фактів і тих самих визначень
            класів, без нашої відповіді. Розбіжності — черга для людини. Прогін — {longDate(judge.started_at)}
          </p>
          <div className="method-kpis">
            <div>
              <strong>{pct(companies.agree_vpk, companies.n)}</strong>
              <span>
                юросіб: згода «ВПК / не ВПК» ({fmt(companies.n)} у вибірці; точний клас — {pct(companies.agree, companies.n)})
              </span>
            </div>
            <div>
              <strong>{pct(vacancies.agree_vpk, vacancies.n)}</strong>
              <span>
                вакансій: згода «ВПК / не ВПК» ({fmt(vacancies.n)} у вибірці; точна мітка — {pct(vacancies.agree, vacancies.n)})
              </span>
            </div>
          </div>
          <p className="method-note">
            Згода найвища там, де ми ухвалили рішення, і найнижча в групах «на перевірці» — саме ці рішення ми й позначаємо як неостаточні. Для вакансій суддя
            бачить лише текст і факти з реєстру та ГУР, без знайденого пошуком, тож для підприємств без опису ГУР частіше відповідає «неясно».
          </p>
          <details>
            <summary>За групами вибірки</summary>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Група</th>
                    <th className="num">У вибірці</th>
                    <th className="num">Згода ВПК / не ВПК</th>
                    <th className="num">Точний клас</th>
                  </tr>
                </thead>
                <tbody>
                  {judge.strata.map((s) => (
                    <tr key={`${s.kind}:${s.stratum}`}>
                      <td>{STRATA[s.stratum] ?? s.stratum}</td>
                      <td className="num">{fmt(s.n)}</td>
                      <td className="num">{pct(s.agree_vpk, s.n)}</td>
                      <td className="num">{pct(s.agree, s.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {judge.disagreements.length > 0 && (
            <details>
              <summary>
                Розбіжності «ВПК / не ВПК»: {fmt(judge.strata.reduce((a, s) => a + s.n - s.agree_vpk, 0))}
                {judge.disagreements.length < judge.strata.reduce((a, s) => a + s.n - s.agree_vpk, 0) && <>, показано {fmt(judge.disagreements.length)} найупевненіших</>}
              </summary>
              <ul className="method-disagreements">
                {judge.disagreements.map((d) => (
                  <li key={`${d.kind}:${d.item_id}`}>
                    {d.kind === 'company' ? (
                      d.card_id ? <Link to={`/companies/${d.card_id}`}>{d.name}</Link> : <b>{d.name}</b>
                    ) : (
                      <Link to={`/vacancies/${d.item_id}`}>{d.name}</Link>
                    )}
                    : у нас «{JUDGE_LABELS[d.our_label] ?? d.our_label}», суддя — «{JUDGE_LABELS[d.judge_label] ?? d.judge_label}». <span className="method-muted">{d.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p>Прогін судді ще не виконано.</p>
      )}

      <h4>Human in the loop</h4>
      <p>
        Людина бачить розбіжності судді й рішення «на перевірці» і виправляє їх на картці підприємства (Human review: джерело, надійність A–F, напрям, санкції,
        дотичність до ВПК) або у вакансії. Ручна ревізія має пріоритет: вона показується з позначкою «Human» замість автоматичного значення, враховується у
        списках, фільтрах, на карті та в експорті; історія ревізій зберігається.{' '}
        {human.employer_reviews + human.vacancy_human > 0 ? (
          <>
            Збережено ручних ревізій карток: {fmt(human.employer_reviews)} ({fmt(human.employer_cards)} карток), оцінок вакансій: {fmt(human.vacancy_human)}.
          </>
        ) : (
          <>Ручних ревізій поки немає: перша черга — розбіжності судді вище.</>
        )}
      </p>
    </section>
  )
}

function Mcp({ mcp }: { mcp: ApiMethodology['mcp'] }) {
  const key = mcp.key ?? '<ключ доступу>'
  const claudeCode = `claude mcp add --transport http stayhard ${mcp.url} \\\n  --header "Authorization: Bearer ${key}"`
  const desktop = JSON.stringify(
    { mcpServers: { stayhard: { command: 'npx', args: ['-y', 'mcp-remote', mcp.url, '--header', `Authorization: Bearer ${key}`] } } },
    null,
    2,
  )
  const cursor = JSON.stringify({ mcpServers: { stayhard: { url: mcp.url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)
  return (
    <section className="panel" id="mcp">
      <h3>MCP: дані для ваших AI-агентів</h3>
      <p>
        Model Context Protocol — відкритий стандарт, через який AI-асистенти (Claude, Cursor, власні агенти) викликають зовнішні інструменти. Наш MCP-сервер дає
        агенту ті самі дані й правила, що й сайт: агент шукає підприємства, читає профілі з класифікацією, санкціями й зв’язками, рахує аналітику й отримує
        посилання на джерела. Відповідь інструмента містить <code>data</code>, <code>sources</code>, <code>as_of</code> і <code>site_url</code>. Ресурс{' '}
        <code>secrethon://methodology</code> пояснює визначення, prompt <code>research_company</code> — порядок дослідження підприємства.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Інструмент</th>
              <th>Що робить</th>
            </tr>
          </thead>
          <tbody>
            {mcp.tools.map((t) => (
              <tr key={t.name}>
                <td>
                  <code>{t.name}</code>
                </td>
                <td className="method-desc">{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!mcp.enabled && <p className="method-note">На цьому сервері MCP зараз вимкнено.</p>}
      <h4>Підключення</h4>
      <dl className="method-mcp">
        <dt>Адреса (Streamable HTTP)</dt>
        <dd>
          <Copyable value={mcp.url} />
        </dd>
        <dt>Ключ доступу</dt>
        <dd>
          {mcp.key ? <Copyable value={`Authorization: Bearer ${mcp.key}`} secret /> : <span>ключ видає команда StayHard; передавайте його в заголовку Authorization: Bearer</span>}
        </dd>
      </dl>
      <p className="method-note">Логін і пароль сайту MCP-клієнту не потрібні — лише ключ у заголовку. Без ключа сервер відповідає 401.</p>
      <h4>Claude Code</h4>
      <pre>
        <code>{claudeCode}</code>
      </pre>
      <h4>Claude Desktop</h4>
      <p>
        Settings → Developer → Edit Config, додайте до <code>claude_desktop_config.json</code> і перезапустіть застосунок (потрібен Node.js для{' '}
        <code>mcp-remote</code>):
      </p>
      <pre>
        <code>{desktop}</code>
      </pre>
      <h4>Cursor та інші клієнти з HTTP-заголовками</h4>
      <p>
        <code>~/.cursor/mcp.json</code> (або налаштування MCP вашого клієнта):
      </p>
      <pre>
        <code>{cursor}</code>
      </pre>
      <p className="method-note">
        Перевірити підключення й подивитися схеми інструментів: <code>npx @modelcontextprotocol/inspector</code> → Streamable HTTP, адреса вище, заголовок
        Authorization. Приклад запиту агенту: «Знайди підприємства БпЛА в Татарстані без санкцій ЄС і дай посилання на джерела».
      </p>
    </section>
  )
}

/** A value with a copy button; secrets are masked until shown. */
function Copyable({ value, secret = false }: { value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }
  return (
    <span className="method-copy">
      <code>{shown ? value : value.replace(/Bearer .+/, 'Bearer ••••••••')}</code>
      {secret && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShown((s) => !s)}>
          {shown ? 'Сховати' : 'Показати'}
        </button>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
        {copied ? 'Скопійовано' : 'Копіювати'}
      </button>
    </span>
  )
}

function Limits() {
  return (
    <section className="panel" id="limits">
      <h3>Що варто знати й обмеження</h3>
      <ul>
        <li>
          <b>«Работа России» (trudvsem)</b> збирали запитами за ВПК і за ІПН підприємств ВПК, тож майже всі її вакансії — ВПК. Це відбір на вході, а не помилка
          класифікатора.
        </li>
        <li>
          <b>Стрибок вакансій у вересні</b> і показник «нових за 30 днів» — момент початку збору, а не сплеск найму: hh.ru показує лише відкриті вакансії.
          Динаміку міряємо тільки між нашими знімками.
        </li>
        <li>Медіана зарплати — лише вакансії з місячною зарплатою в рублях; якщо вказано діапазон, береться його середина.</li>
        <li>Регіон: у trudvsem його вказано; для hh.ru визначаємо за містом.</li>
        <li>Контакти лише корпоративні (телефон, пошта, сайт) і керівник юрособи за реєстром. Рекрутерів і працівників не профілюємо.</li>
        <li>
          Частина підприємств ВПК не публікує вакансій відкрито, тож реальний найм більший, ніж ми бачимо. Зв’язок hh.ru з юрособою за назвою позначено
          «ймовірний» або «під питанням». «На перевірці» означає саме ймовірність, а не доведений факт.
        </li>
      </ul>
    </section>
  )
}

/** Search log rows by provider and result. */
function DiscoverySummary() {
  const state = useApi('discovery-summary', (signal) => api.discoverySummary(signal))
  if (state.status !== 'ready') return <div className="skeleton" style={{ height: 120 }} />
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Джерело</th>
            <th>Результат</th>
            <th className="num">Записів</th>
          </tr>
        </thead>
        <tbody>
          {state.data.map((r) => (
            <tr key={`${r.provider}:${r.status}`}>
              <td>{PROVIDERS[r.provider] ?? r.provider}</td>
              <td>{DISCOVERY_STATUS[r.status]}</td>
              <td className="num">{fmt(r.rows)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
