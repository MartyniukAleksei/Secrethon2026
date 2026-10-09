"""Small progress dashboard and final report for a complete vacancy run."""

# ruff: noqa: E501 -- self-contained HTML/JS

import json
from collections import Counter

from app.vacancy_labeling import ROLE_LABELS, domain_label


def write_dashboard(output):
    (output / "index.html").write_text(DASHBOARD, encoding="utf-8")


def write_summary(output, manifest, rows, receipt=None):
    domains, roles = Counter(), Counter()
    companies = {}
    for row in rows:
        if row["status"] != "ok":
            continue
        domain = row["decisions"]["domain"]["choice"]
        role = row["decisions"]["role"]["choice"]
        domains[domain] += 1
        roles[role] += 1
        ident = row.get("card_id")
        company = companies.setdefault(
            ident,
            {
                "id": ident,
                "name": row.get("company_name") or "Невідомо",
                "total": 0,
                "active": 0,
                "review": 0,
                "domains": Counter(),
                "roles": Counter(),
            },
        )
        company["total"] += 1
        company["active"] += bool(row.get("is_active"))
        company["review"] += row["review"]
        company["domains"][domain] += 1
        company["roles"][role] += 1
    summary = {
        "scope": manifest["scope"],
        "selected": manifest["selected"],
        "success": manifest["success"],
        "errors": manifest["errors"],
        "review": manifest["review"],
        "distinct_inputs": manifest["distinct_inputs"],
        "models_returned": manifest["models_returned"],
        "domains": [
            {"code": code, "label": domain_label(code), "count": count}
            for code, count in domains.most_common()
        ],
        "roles": [
            {"code": code, "label": ROLE_LABELS[code], "count": count}
            for code, count in roles.most_common()
        ],
        "companies": sorted(companies.values(), key=lambda c: (-c["total"], c["name"])),
        "import": receipt,
    }
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    published = receipt is not None
    vpk_scope = manifest["scope"] == "vpk_active_unique"
    md = [
        "# Повна класифікація вакансій ВПК JEV" if vpk_scope else "# Класифікація вакансій JEV",
        "",
        "**"
        + (
            f"Записано в БД: {receipt['imported']} міток. Прогін `{receipt['run_id']}`."
            if published
            else "Класифікація збережена локально; імпорт ще не завершено."
        )
        + "**",
        "",
        f"Вакансій: {manifest['success']}/{manifest['selected']}; "
        f"помилок: {manifest['errors']}; на ручну перевірку: {manifest['review']}.",
        "",
        f"Різних вхідних текстів: {manifest['distinct_inputs']}. "
        f"Моделі: {', '.join(manifest['models_returned'])}.",
        "",
        "Охоплено всі активні вакансії ВПК без дублів, підтверджені або ймовірні. "
        "Відсіяні записи й вакансії агенцій не входять у прогін."
        if vpk_scope
        else "Охоплено всі сирі записи, включно з неактивними й копіями. Частки нижче рахуються "
        "за цими записами; аналітика сайту використовує активні вакансії без дублів "
        "та чинні критерії належності підприємства до ВПК.",
        "",
        "Галузь і роль визначені за обов’язками конкретної вакансії, а не назвою роботодавця. "
        "Використано наявні 16 галузей і 9 ролей; none означає недостатність даних. "
        "Точні повтори вхідного тексту використовують спільну відповідь JEV. "
        "Невизначені мітки та confidence нижче 75% збережені з прапорцем review. "
        "Confidence моделі не є виміряною точністю.",
        "",
        "## Галузі",
        "",
        "| Галузь | Вакансій | Частка |",
        "|---|---:|---:|",
    ]
    for code, count in domains.most_common():
        md.append(f"| {domain_label(code)} | {count} | {count / manifest['success']:.1%} |")
    md += ["", "## Ролі діяльності", "", "| Роль | Вакансій | Частка |", "|---|---:|---:|"]
    for code, count in roles.most_common():
        md.append(f"| {ROLE_LABELS[code]} | {count} | {count / manifest['success']:.1%} |")
    md += [
        "",
        "## Збереження та перевірка",
        "",
        "- [CSV усіх вакансій](vacancies.csv): ID, мітки, confidence і review.",
        "- [Метрики та розподіли за підприємствами](summary.json).",
        "- [Методика та звірка повноти](manifest.json).",
        "- inputs.jsonl: очищені вхідні тексти; responses.jsonl: сирі відповіді JEV; "
        "labels.jsonl: рішення всіх ID.",
        "- backups/: резервна копія попередніх класифікацій зі SHA-256.",
    ]
    if receipt:
        md += [
            "- [Квитанція імпорту](import_receipt.json).",
            "",
            "Старі класифікації підприємств, рішення про ВПК і людські рев’ю збережені. "
            "Новий прогін опубліковано однією транзакцією після звірки ID та текстів. "
            "Історія прогонів залишається в БД.",
            "",
            "Команда відкату (з папки backend):",
            "```powershell",
            receipt["withdraw_command"],
            "```",
        ]
    md += [
        "",
        "Схема API й обробка лімітів: [офіційна документація JEV](https://docs.typesafe.ai/api).",
        "",
    ]
    (output / "REPORT.md").write_text("\n".join(md), encoding="utf-8")
    write_dashboard(output)
    return summary


# Static page reads only local report files; no credentials, external assets or DB access.
DASHBOARD = """<!doctype html><html lang="uk"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JEV — усі вакансії</title><style>
*{box-sizing:border-box}body{margin:0;background:#e5e8dd;color:#1d2119;font:16px/1.55 system-ui}
main{max-width:1280px;margin:30px auto;padding:0 24px}h1{font-size:34px;margin:16px 0}
p{color:#58604e}a{color:#475929}.tag{background:#dce6c7;padding:7px 12px;border-radius:20px}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}
.metric,section{background:#f8f9f3;border-radius:22px;padding:24px;margin-bottom:18px}
.metric{margin:0}.metric b{display:block;font-size:32px}.metric span{color:#58604e}
progress{width:100%;height:20px;accent-color:#4e612c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 7px;border-bottom:1px solid #dce1d3}
td:last-child,th:last-child{text-align:right;white-space:nowrap}th{color:#58604e}
nav{display:flex;gap:20px;flex-wrap:wrap}input{width:100%;padding:12px;border:1px solid #dce1d3;border-radius:12px;font:inherit}
.table-wrap{overflow-x:auto}button{padding:8px 14px;border:1px solid #dce1d3;border-radius:10px;background:#fff;cursor:pointer}
.pages{display:flex;align-items:center;justify-content:space-between;margin:14px 0}
@media(max-width:700px){.metrics,.grid{grid-template-columns:1fr}h1{font-size:28px}section{padding:18px}}
</style><main><span class="tag" id="stage">Повний прогін JEV</span>
<h1>Класифікація вакансій JEV</h1>
<p>Галузь та роль за обов’язками конкретної вакансії</p>
<div class="metrics"><div class="metric"><b id="done">—</b><span>вакансій розмічено</span></div>
<div class="metric"><b id="total">—</b><span>вакансій у прогоні</span></div>
<div class="metric"><b id="review">—</b><span>потребують ручної перевірки</span></div></div>
<section><h2>Стан прогону</h2><progress id="bar" value="0" max="1"></progress>
<p id="status">Читаю контрольну точку…</p><p id="details"></p>
<nav><a href="vacancies.csv">CSV усіх вакансій</a><a href="REPORT.md">Повний звіт</a>
<a href="manifest.json">Методика</a><a href="summary.json">Метрики</a></nav></section>
<div id="results" hidden><div class="grid"><section><h2>Галузі JEV</h2><table><tbody id="domains"></tbody></table></section>
<section><h2>Ролі діяльності</h2><table><tbody id="roles"></tbody></table></section></div>
<section><h2>Розподіл за підприємствами</h2><p>Вакансії, які входять у цей прогін; обсяг визначено в методиці.</p>
<input id="search" aria-label="Пошук підприємства" placeholder="Назва підприємства або ID">
<div class="pages"><button id="prev">← Попередні</button><span id="count"></span><button id="next">Наступні →</button></div>
<div class="table-wrap"><table><thead><tr><th>Підприємство</th><th>Галузі</th><th>Усього</th><th>Активні</th><th>На перевірку</th></tr></thead>
<tbody id="companies"></tbody></table></div></section></div>
<p>Результати JEV є оцінкою моделі. Невизначені категорії та низька впевненість позначаються для ручної перевірки.
Попередні рішення про підприємства та їхню належність до ВПК зберігаються.</p></main><script>
const $=id=>document.getElementById(id),n=v=>Number(v).toLocaleString('uk-UA');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let summary=null,page=0;
function rows(values){return values.map(r=>`<tr><td>${esc(r.label)}</td><td>${n(r.count)} · ${(r.count/summary.success*100).toLocaleString('uk-UA',{maximumFractionDigits:1})}%</td></tr>`).join('')}
function render(){if(!summary)return;const q=$('search').value.toLocaleLowerCase('uk-UA');
const list=summary.companies.filter(c=>c.name.toLocaleLowerCase('uk-UA').includes(q)||String(c.id??'').includes(q));
page=Math.min(page,Math.max(0,Math.ceil(list.length/25)-1));const start=page*25;
$('count').textContent=`${list.length?start+1:0}–${Math.min(start+25,list.length)} із ${n(list.length)}`;
$('prev').disabled=page===0;$('next').disabled=start+25>=list.length;
const labels=Object.fromEntries(summary.domains.map(d=>[d.code,d.label]));
$('companies').innerHTML=list.slice(start,start+25).map(c=>`<tr><td>${c.id?`<a href="http://127.0.0.1:5173/companies/${Number(c.id)}">${esc(c.name)}</a>`:esc(c.name)}<br><small>ID ${esc(c.id)}</small></td><td>${Object.entries(c.domains).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${esc(labels[k]??k)}: ${n(v)}`).join('<br>')}</td><td>${n(c.total)}</td><td>${n(c.active)}</td><td>${n(c.review)}</td></tr>`).join('')}
$('search').addEventListener('input',()=>{page=0;render()});$('prev').onclick=()=>{page--;render()};$('next').onclick=()=>{page++;render()};
async function update(){try{const res=await fetch('progress.json',{cache:'no-store'});if(!res.ok)return;const p=await res.json();
$('done').textContent=n(p.success);$('total').textContent=n(p.selected);$('bar').value=p.success;$('bar').max=p.selected;
$('stage').textContent=p.database_written?'Записано в БД':p.pending_records===0?'Перевірка та імпорт':'Класифікація JEV триває';
$('status').textContent=`${n(p.completed_inputs)} / ${n(p.distinct_inputs)} різних текстів · ${n(p.success)} / ${n(p.selected)} вакансій`;
$('details').textContent=`${p.scope==='vpk_active_unique'?'Активні вакансії ВПК без дублів · ':''}Контрольна точка: ${new Date(p.updated_at).toLocaleString('uk-UA')}${p.database_written?' · Імпортовано '+n(p.imported)+' міток':''}`;
if(p.pending_records===0){const s=await fetch('summary.json',{cache:'no-store'});if(s.ok){summary=await s.json();$('review').textContent=n(summary.review);$('domains').innerHTML=rows(summary.domains);$('roles').innerHTML=rows(summary.roles);$('results').hidden=false;render()}}
}catch(e){$('details').textContent='Контрольна точка оновлюється; повторю читання.'}}
update();setInterval(update,10000);
</script></html>"""
