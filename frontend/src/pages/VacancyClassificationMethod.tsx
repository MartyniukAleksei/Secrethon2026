import { Link } from 'react-router'
import { vacancyClassificationSnapshot as run } from '../data/vacancyClassificationSnapshot'
import { fmt, longDate } from '../domain/format'
import { DOMAINS, ROLES } from '../domain/labels'

const share = (count: number, total: number) => `${(total ? count / total * 100 : 0).toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
const ROLE_NAMES: Record<string, string> = { ...ROLES, manufacturer: 'Виробництво', intermediary: 'Посередництво', management: 'Управління', component_supplier: 'Постачання компонентів', equipment_supplier: 'Постачання обладнання', none: 'Роль не визначено' }
const VERDICTS = [
  ['supported', 'Підтверджено GPT'],
  ['incorrect', 'Помилка за оцінкою GPT'],
  ['ambiguous', 'Неоднозначно'],
  ['insufficient', 'Бракує даних'],
] as const
const judge = run.judge
const published = new Date(run.published_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function Distribution({ counts, names, total, label }: { counts: Record<string, number>; names: Record<string, string>; total: number; label: string }) {
  return <div className="table-wrap">
    <table className="data" aria-label={label}>
      <thead><tr><th>{label}</th><th className="num">Вакансій</th><th className="num">Частка</th></tr></thead>
      <tbody>{Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, count]) => <tr key={key}>
        <td className="method-desc">{names[key] ?? key}</td><td className="num">{fmt(count)}</td><td className="num">{share(count, total)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function VacancyClassificationMethod() {
  return <section className="panel" id="vacancy-directions">
    <h3>Галузі та види діяльності вакансій: JEV і перевірка GPT</h3>
    <p>
      Після відбору вакансій ВПК окремо розмітили, <b>чим займається працівник</b>. Раніше галузь вакансії успадковувалася від підприємства:
      у роботодавця, пов’язаного з БпЛА, до БпЛА потрапляли й будівельник, і бухгалтер. Тепер галузь і вид діяльності визначаємо
      за назвою посади, обов’язками та вимогами конкретного оголошення.
    </p>
    <p className="method-note">
      Це підсумок опублікованого прогону, а не поточні лічильники бази. Зріз — {longDate(run.snapshot_date)};
      запис у БД — {published} (Київ). Модель JEV — <b>{run.models.join(', ')}</b>.
    </p>

    <h4>Що увійшло у повний прогін</h4>
    <p>
      Усі <b>{fmt(run.selected)} активних вакансій ВПК без дублів</b> з рішенням «підтверджено» або «на перевірці».
      Вакансії прив’язані до {fmt(run.employers)} карток роботодавців; ще {fmt(run.unlinked_vacancies)} не мають прив’язки до картки.
      Вакансії кадрових агентств, відсіяні та неактивні записи не входять у цей прогін.
      Частки рахуємо за кількістю вакансій, а не різних професій чи текстів.
    </p>
    <div className="method-kpis">
      <div><strong>{fmt(run.success)}</strong><span>із {fmt(run.selected)} вакансій розмічено й записано у БД — 100% покриття</span></div>
      <div><strong>{fmt(run.errors)}</strong><span>невдалих результатів після повторних запитів; пропущених і зайвих ID — 0</span></div>
      <div><strong>{fmt(run.review)}</strong><span>{share(run.review, run.selected)} вакансій позначено для ручної перевірки</span></div>
      <div><strong>{fmt(run.distinct_inputs)}</strong><span>різних вхідних текстів; точні повтори використовують спільну відповідь</span></div>
    </div>

    <h4>Як ми це зробили</h4>
    <ol className="method-steps">
      <li><b>Взяли довідник із БД.</b> Використали наявні 16 галузей і 9 видів діяльності, додали варіант «не визначено», коли тексту замало.
        Це довідник напрямів діяльності, а не детальна класифікація професій. Галузь і вид діяльності — два окремі виміри.</li>
      <li><b>Підготували текст вакансії.</b> Назва посади, обов’язки, вимоги, професія, спеціалізація й опис;
        HTML перетворили на звичайний текст, прибрали скрипти, стилі, телефони й email.
        Обов’язки мають пріоритет перед рекламним описом компанії. Назву роботодавця й успадковані галузі окремими полями не передавали.</li>
      <li><b>Уточнили правила вибору.</b> БпЛА — безпосередня розробка, виробництво, складання, експлуатація чи випробування дронів.
        Будівництво, HR, охорона, освіта, харчування й загальне IT — «Цивільна діяльність»; бухгалтерія — «Фінанси».
        Дослідження конкретного виробу належить до його галузі, а загальна металообробка без указаного виробу — до «Верстати і матеріали».</li>
      <li><b>Зробили пілот для перегляду.</b> {fmt(run.pilot.selected)} вакансій: по {run.pilot.per_company} в Алабузі,
        Роскосмосі, СТЦ та Авіакорі. Брали по одному оголошенню на назву професії: 8 найчастіших назв і решту за відтворюваним хешем.
        Цей пілот показував різноманітність посад; його відсотки не переносили на всі вакансії підприємства.</li>
      <li><b>Перевірили повну Алабугу.</b> Розмітили {fmt(judge.total)} активні вакансії без дублів — усі оголошення компанії у вибірці,
        потім виконали окреме рев’ю моделлю <b>{judge.model}</b>. Обидва тестові прогони зберігали результати у файли;
        пропозиції GPT автоматично не застосовували.</li>
      <li><b>Обробили всю вибірку ВПК.</b> JEV повертав розподіл ймовірностей за варіантами для кожного з двох питань.
        Зберегли повні відповіді, вибрану категорію та її confidence. Для {fmt(run.cached_inputs)} різних текстів
        повторно використали відповіді з попередніх прогонів лише за збігу всього вхідного тексту, критеріїв, моделі й версії запитань.
        Для решти {fmt(run.distinct_inputs - run.cached_inputs)} різних текстів отримали нові відповіді; невдалі запити повторили.</li>
      <li><b>Перевірили повноту й актуальність.</b> До імпорту звірили точний набір ID, поточні тексти з експортом
        та всі мітки із сирими відповідями JEV. Імпорт вимагав 100% покриття й нуль невдалих результатів.
        Після запису повторно перевірили вибірку: пропущених і сторонніх вакансій — 0.</li>
      <li><b>Опублікували одним записом прогону.</b> Зберегли резервну копію, усі мітки записали однією транзакцією.
        Класифікації підприємств, рішення про ВПК та людські рев’ю збережені; історія прогонів дозволяє відкликати публікацію.</li>
    </ol>

    <h4>Поріг ручної перевірки</h4>
    <p>
      Якщо галузь чи вид діяльності не визначено або confidence хоча б одного з цих рішень нижче <b>{run.threshold * 100}%</b>,
      вакансія отримує позначку «Класифікація потребує перевірки». Таких вакансій — {fmt(run.review)} ({share(run.review, run.selected)}).
      Мітки з цією позначкою також збережені й беруть участь у розподілах; позначка не означає, що людина вже їх перевірила.
    </p>
    <p className="method-note">
      Confidence — впевненість моделі, а не виміряна точність. Нуль помилок обробки означає, що всі запити завершилися валідним результатом,
      а не що всі категорії правильні. Для перевірки якості потрібні незалежне рев’ю та людська еталонна розмітка.
    </p>

    <h4>Результат: галузі й види діяльності</h4>
    <p>Знаменник обох розподілів — {fmt(run.selected)} вакансій. «Не визначено» залишено у підсумку; частки округлено до десятих.</p>
    <details><summary>Усі 16 галузей та невизначені вакансії</summary>
      <Distribution counts={run.domains} names={{ ...DOMAINS, none: 'Галузь не визначено' }} total={run.selected} label="Галузь" />
    </details>
    <details><summary>Усі 9 видів діяльності та невизначені вакансії</summary>
      <Distribution counts={run.roles} names={ROLE_NAMES} total={run.selected} label="Вид діяльності" />
    </details>
    <p className="method-note">
      Найбільші групи: «Цивільна діяльність» — {fmt(run.domains.civil_other)} ({share(run.domains.civil_other, run.selected)}),
      «Верстати і матеріали» — {fmt(run.domains.machining_materials)} ({share(run.domains.machining_materials, run.selected)}),
      «Радіоелектроніка і зв’язок» — {fmt(run.domains.electronics_comms)} ({share(run.domains.electronics_comms, run.selected)}).
    </p>

    <h4>LLM as a judge: повна Алабуга</h4>
    <p>
      Модель <b>{judge.model}</b> оцінила {fmt(judge.evaluated)} із {fmt(judge.total)} вакансій — {fmt(judge.unique_texts_evaluated)} різних повних текстів,
      помилок обробки — {judge.errors}. Спочатку GPT незалежно класифікував текст без міток і confidence JEV.
      Потім перевірив кандидатні мітки за тим самим довідником, із поясненням і посиланням на рядок тексту.
      Цитату брали з оригіналу, а відповіді без перевірюваного підтвердження не приймали.
      Обидва етапи пройшов кожен різний текст, навіть за збігу категорій.
    </p>
    <div className="method-kpis">
      <div><strong>{share(judge.vacancy.domain.supported, judge.evaluated)}</strong><span>галузей підтверджено GPT: {fmt(judge.vacancy.domain.supported)} / {fmt(judge.evaluated)}</span></div>
      <div><strong>{share(judge.vacancy.role.supported, judge.evaluated)}</strong><span>видів діяльності підтверджено GPT: {fmt(judge.vacancy.role.supported)} / {fmt(judge.evaluated)}</span></div>
    </div>
    <div className="table-wrap">
      <table className="data method-vacancy-judge" aria-label="Оцінки GPT за вакансіями й різними текстами">
        <thead><tr><th>Оцінка GPT</th><th className="num">Галузь: вакансії</th><th className="num">Вид діяльності: вакансії</th><th className="num">Галузь: тексти</th><th className="num">Вид діяльності: тексти</th></tr></thead>
        <tbody>{VERDICTS.map(([key, label]) => <tr key={key}>
          <td className="method-desc">{label}</td>
          {([['vacancy', 'domain'], ['vacancy', 'role'], ['unique_text', 'domain'], ['unique_text', 'role']] as const).map(([group, dim]) => {
            const counts: Partial<Record<(typeof VERDICTS)[number][0], number>> = judge[group][dim]
            const count = counts[key] ?? 0
            return <td className="num" key={`${group}-${dim}`}>{fmt(count)}<span className="method-score-share">{share(count, group === 'vacancy' ? judge.evaluated : judge.unique_texts_evaluated)}</span></td>
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <p className="method-note">Однакові повні тексти мають спільну оцінку. Підсумок за вакансіями враховує кількість повторів;
      підсумок за різними текстами дає однакову вагу кожному опису, щоб часті посади не приховували проблем рідкісних.</p>
    <ul>
      <li>Підтверджено обидва виміри: {fmt(judge.vacancy.both_supported)} ({share(judge.vacancy.both_supported, judge.evaluated)}).
        Принаймні одна помилка за оцінкою GPT — у {fmt(judge.vacancy.any_incorrect)} вакансіях.</li>
      <li>Збіг зі сліпою розміткою GPT: галузь — {fmt(judge.vacancy.domain_blind_agreement)} / {fmt(judge.evaluated)} ({share(judge.vacancy.domain_blind_agreement, judge.evaluated)}),
        вид діяльності — {fmt(judge.vacancy.role_blind_agreement)} / {fmt(judge.evaluated)} ({share(judge.vacancy.role_blind_agreement, judge.evaluated)}).</li>
      <li>{fmt(judge.high_confidence_errors)} вакансій мали помилку за оцінкою GPT навіть при confidence відповідного рішення JEV ≥ 90%.
        У {fmt(judge.missed_by_jev_review_flag)} вакансіях початкова позначка ручної перевірки не охопила помилку, яку вказав GPT.</li>
    </ul>
    <details><summary>Найчастіші розбіжності для подальшого рев’ю</summary>
      <ul>
        <li>Вид діяльності: «НДДКР → Послуги» — 123 вакансії; «Виробництво → НДДКР» — 69; «Ремонт → Послуги» — 54.</li>
        <li>Галузь: «Цивільна діяльність → Радіоелектроніка і зв’язок» — 23 вакансії; «Цивільна діяльність → Торгівля і логістика» — 16;
          «БпЛА → Цивільна діяльність» — 13.</li>
      </ul>
      <p className="method-note">Це пропозиції GPT для перегляду. Вони не є автоматично застосованими виправленнями.</p>
    </details>
    <p className="method-note">
      Це оцінка іншої моделі й збіг моделей, а не точність на людському еталоні. Обидва етапи рев’ю виконував той самий GPT;
      це не два незалежні судді. Перевірка охопила Алабугу, її відсотки не переносимо на всі {fmt(run.selected)} вакансій ВПК.
      GPT перевіряв відповідність заданому довіднику; правильність самого довідника цим не доведена.
    </p>

    <h4>Як це відображається на сайті</h4>
    <p>
      У <Link to="/vacancies">списку вакансій</Link> додано колонку «Галузь», у картці — галузь, вид діяльності та позначку потреби перевірки.
      Фільтри й аналітика агента використовують розмітку конкретних вакансій.
      Для <Link to="/companies/4064">Алабуги</Link> «Цивільна діяльність» — {fmt(judge.jev_domains.civil_other)} ({share(judge.jev_domains.civil_other, judge.total)}),
      БпЛА — {fmt(judge.jev_domains.uav)} ({share(judge.jev_domains.uav, judge.total)}).
      Невизначена галузь не підміняється галуззю роботодавця. Для ще не розмічених вакансій успадковану категорію підписано «Галузь підприємства».
    </p>
    <p className="method-note">Human review і LLM review у картці — оцінки дотичності до ВПК, з власною історією.
      Розмітка галузей JEV та рев’ю GPT з цього прогону не заповнювали ці статуси.</p>

    <h4>Обмеження та відтворюваність</h4>
    <ul>
      <li>Цивільна посада у підприємстві ВПК залишається у вибірці ВПК. Її галузь описує роботу працівника, а не змінює статус підприємства.</li>
      <li>Класифікатор бачить оголошення, а не фактичну роботу, продукцію чи чисельність працівників. Рекламні згадки й неповні описи можуть спричиняти помилки.</li>
      <li>Будівництво, HR та загальне IT об’єднано у цивільній категорії. Окремих категорій для цих професій у використаному довіднику немає.</li>
      <li>Довгі поля обмежено: назва, професія й спеціалізація — по 500 символів, обов’язки — 5 000, вимоги — 3 000, опис — 10 000.
        Обрізання зафіксовано у вхідних даних і може впливати на рішення.</li>
      <li>Потрібна ручна перевірка розбіжностей і частини впевнених відповідей. Пропозиції GPT не застосовано до опублікованих міток JEV.</li>
    </ul>
    <details><summary>Опублікований прогін і контроль збереження</summary>
      <p>Версія запитань: <code>{run.prompt_version}</code>. ID прогону: <code>{run.run_id}</code>.
        Збережено очищені входи, повні відповіді, мітки кожного ID, confidence і прапорець перевірки, квитанцію імпорту та резервну копію.
        Кількість попередніх класифікацій підприємств і вакансій після запису не змінилася.</p>
      <p className="method-note">Контрольна сума SHA-256 файлу міток: <code className="method-checksum">{run.source_sha256}</code>.</p>
    </details>
    <p className="method-note"><a href="/classification/vacancy-duties-2026-10-09.json" download>Завантажити метрики цього прогону (JSON)</a>:
      обсяг, розподіли, оцінки GPT і реквізити публікації. Джерело чисел — збережені звіти класифікації та квитанція імпорту.</p>
  </section>
}
