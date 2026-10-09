import './ClassificationFlow.css'

type Node = { title: string; text: string; tone?: 'input' | 'model' | 'rule' | 'check' | 'output' }
type Stage = { label: string; nodes: Node[] }

/** The pipeline from job ads to labels, top to bottom; parallel steps share a row. */
const STAGES: Stage[] = [
  {
    label: 'Збір',
    nodes: [
      { title: 'hh.ru', text: '~1,8 тис. пошуків за ключовими групами + усі вакансії роботодавців ВПК', tone: 'input' },
      { title: 'SuperJob', text: 'внутрішнє API сайту, уся Росія; картки роботодавців з ІПН', tone: 'input' },
      { title: '«Работа России»', text: 'відкрите API за ВПК-запитами та за ІПН підприємств', tone: 'input' },
      { title: 'Портал ГУР', text: 'Ростех, БпЛА, заводи з обладнанням, санкції: профілі, продукція, зв’язки', tone: 'input' },
    ],
  },
  {
    label: 'Відбір',
    nodes: [
      {
        title: 'Ключові слова',
        text: 'групи слів в одному реченні (до 60 символів між ними) + маркери прихованого ВПК: держтаємниця, ДОЗ, військове приймання, ОПК',
        tone: 'rule',
      },
    ],
  },
  {
    label: 'Юрособа',
    nodes: [
      { title: 'ІПН', text: 'з сайту вакансій або сайту роботодавця (з контрольною сумою)', tone: 'rule' },
      { title: 'ЄДРЮЛ і DaData', text: 'за назвою та регіоном, правила з упевненістю 0,6–0,95', tone: 'rule' },
      { title: 'Дедуплікація', text: 'повтори вакансій, склейка профілів у картки, дублі компаній', tone: 'rule' },
    ],
  },
  {
    label: 'Досьє',
    nodes: [
      { title: 'Факти з БД', text: 'розділи й опис ГУР, ОКВЕД і статус з реєстру, санкції, OpenSanctions, вакансії', tone: 'input' },
      {
        title: 'Пошук Exa → LLM',
        text: 'Gemini / GPT виписує факти з дослівними цитатами; скрипт лишає лише ті, чию цитату знайдено на сторінці',
        tone: 'model',
      },
    ],
  },
  {
    label: 'Рішення',
    nodes: [
      {
        title: 'JEV',
        text: 'рушій рішень відповідає на три питання за досьє — категорія, галузь, роль — і дає розподіл ймовірностей',
        tone: 'model',
      },
    ],
  },
  {
    label: 'Правила',
    nodes: [
      {
        title: 'Поверх JEV',
        text: 'неможливі для країни мітки прибрано; цивільна під санкціями — лише з санкціями; поріг 0,9 → «рішення», нижче → «на перевірці»; ВПК з цивільним напрямом — перепитати',
        tone: 'rule',
      },
    ],
  },
  {
    label: 'Результат',
    nodes: [
      { title: 'Клас юрособи', text: 'категорія, рівень, галузь і роль, надійність A1–F6', tone: 'output' },
      { title: 'Фокус', text: 'БпЛА / Ракети / КАБ: озброєння й моделі ГУР, напрям, вакансії, питання до JEV', tone: 'output' },
      { title: 'Мітка вакансії', text: 'вирішує підприємство; без юрособи — JEV за текстом вакансії', tone: 'output' },
    ],
  },
  {
    label: 'Перевірка',
    nodes: [
      { title: 'LLM as a judge', text: 'інша модель наосліп перевіряє вибірку за тими самими фактами', tone: 'check' },
      { title: 'Human in the loop', text: 'розбіжності та «на перевірці» — на ручну ревізію; вона має пріоритет на сайті', tone: 'check' },
    ],
  },
]

export function ClassificationFlow() {
  return (
    <ol className="flow" aria-label="Схема збору та класифікації">
      {STAGES.map((stage, i) => (
        <li key={stage.label} className="flow-stage">
          <div className="flow-label">
            <span className="flow-step">{i + 1}</span>
            {stage.label}
          </div>
          <div className="flow-nodes">
            {stage.nodes.map((n) => (
              <div key={n.title} className={`flow-node flow-${n.tone ?? 'rule'}`}>
                <b>{n.title}</b>
                <span>{n.text}</span>
              </div>
            ))}
          </div>
          {i < STAGES.length - 1 && (
            <svg className="flow-arrow" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v15M6 13l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </li>
      ))}
      <li className="flow-legend" aria-hidden="true">
        <span className="flow-input">джерело даних</span>
        <span className="flow-rule">правило / скрипт</span>
        <span className="flow-model">модель</span>
        <span className="flow-output">результат</span>
        <span className="flow-check">перевірка</span>
      </li>
    </ol>
  )
}
