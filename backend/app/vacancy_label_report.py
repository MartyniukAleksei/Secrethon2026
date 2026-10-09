"""Local, self-contained review report. Escapes vacancy content and embeds no secrets."""

# ruff: noqa: E501 -- self-contained HTML/JS and Ukrainian report paragraphs

import json
from collections import Counter
from html import escape

from app.vacancy_labeling import ROLE_LABELS, domain_label


def company_summary(results):
    companies = {}
    for row in results:
        company = companies.setdefault(
            row["card_id"],
            {
                "name": row["company_name"],
                "sample": 0,
                "success": 0,
                "review": 0,
                "changed": 0,
                "domains": Counter(),
                "roles": Counter(),
                "old_domains": Counter(),
            },
        )
        company["sample"] += 1
        company["review"] += bool(row["review"])
        if row["status"] == "ok":
            company["success"] += 1
            decisions = row["decisions"]
            company["domains"][decisions["domain"]["choice"]] += 1
            company["roles"][decisions["role"]["choice"]] += 1
            company["old_domains"][row["old_domain"] or "none"] += 1
            company["changed"] += decisions["domain"]["choice"] != (row["old_domain"] or "none")
    return companies


def write_report(output, manifest, results):
    summaries = company_summary(results)
    verification = manifest.get("post_run_verification", {})
    coverage = verification.get("coverage", {})
    coverage_note = ""
    if coverage:
        coverage_note = (
            f"Звірка ID з БД: очікувалося {coverage['expected_active_unique']}, "
            f"успішно розмічено {coverage['classified_unique']}, "
            f"пропущено {len(coverage['missing_ids'])}, "
            f"зайвих {len(coverage['unexpected_ids'])}. "
        )
        raw = verification.get("company_raw_counts", {})
        if raw and manifest["scope"] == "company_full_active":
            coverage_note += (
                f"Сирих активних записів: {raw['raw_active']}; "
                f"дублів: {raw['raw_active'] - coverage['expected_active_unique']}. "
            )
        if verification.get("inventory_unchanged"):
            coverage_note += "Після прогону кількість записів і дата зрізу БД не змінилися."
    sampling_note = (
        "Усі активні вакансії вибраних підприємств без дублів, без вибірки за професіями. "
        "Частки розраховано за кількістю вакансій, а не різних назв посад. "
        + ("Застосовано обмеження --limit; це неповний прогін." if manifest.get("limit") else "")
        if manifest["scope"] == "company_full_active"
        else "Повний режим читає сирі записи, включно з неактивними та копіями. "
        "За наявності --limit це лише обмежений прогін. Частки стосуються оброблених записів."
        if manifest["scope"] == "all_raw"
        else "Пілот: по одній вакансії на назву професії. Включено 8 найпоширеніших назв, "
        "решту вибрано відтворювано за хешем назви. Це вибірка різних професій: відсотки нижче "
        "стосуються лише перевірених вакансій і не оцінюють усі вакансії підприємства."
    )
    markdown = [
        "# Тестова розмітка вакансій JEV",
        "",
        "**Це тестовий прогін. Результати збережені лише у файлах; БД не змінена.**",
        "",
        f"Дата зрізу: {manifest['database_inventory']['as_of']}. "
        f"Модель: {', '.join(manifest['models_returned']) or 'відповіді немає'}.",
        "",
        f"У БД: {manifest['database_inventory']['total']:,} вакансій, "
        f"активних — {manifest['database_inventory']['active']:,}, "
        f"активних без дублів — {manifest['database_inventory']['unique_active']:,}.",
        "",
        f"Прогін: {manifest['selected']} записів, успішно {manifest['success']}, "
        f"помилок {manifest['errors']}, на перевірку {manifest['review']}.",
        "",
        coverage_note,
        "",
        "## Методика",
        "",
        "Галузь визначена за назвою, описом, обов’язками та вимогами конкретної вакансії. "
        "Назва підприємства і його попередня галузь не передаються класифікатору. "
        "Рекламний опис діяльності роботодавця не вважається обов’язками працівника.",
        "",
        "Використано коди, прочитані з company_classification.direction_domain та direction_role; "
        "окремої таблиці галузей зайнятості в цій БД немає. «none» означає недостатність даних, "
        "а не нову галузь. Цивільне будівництво, HR, охорона, загальне IT та інші допоміжні "
        "роботи входять у наявну категорію «Цивільна діяльність». Роль — другий незалежний "
        "вимір діяльності (виробництво, НДДКР, ремонт, послуги тощо), а не новий довідник професій.",
        "",
        sampling_note,
        "",
        f"На ручну перевірку: невизначені категорії та confidence нижче {manifest['threshold']:.0%}. "
        "Це початковий поріг, а не виміряна точність. Навіть висока впевненість моделі може бути хибною.",
        "",
        "## Результат за підприємствами",
        "",
        "| Підприємство | Перевірено | Зміна галузі | На перевірку |",
        "|---|---:|---:|---:|",
    ]
    for ident, company in summaries.items():
        name = company["name"].replace("|", "\\|")
        markdown.append(
            f"| [{name}](http://127.0.0.1:5173/companies/{ident}) | "
            f"{company['success']}/{company['sample']} | {company['changed']} | {company['review']} |"
        )
    for company in summaries.values():
        markdown += [
            "",
            f"### {company['name']}",
            "",
            "| Галузь JEV | Кількість | Частка оброблених вакансій |",
            "|---|---:|---:|",
        ]
        for code, count in company["domains"].most_common():
            markdown.append(
                f"| {domain_label(code)} | {count} | {count / company['success']:.1%} |"
            )
        markdown += [
            "",
            "Ролі: "
            + "; ".join(
                f"{ROLE_LABELS.get(code, code)} — {n}" for code, n in company["roles"].most_common()
            )
            + ".",
        ]
    markdown += [
        "",
        "## Як перевірити",
        "",
        "Відкрийте [інтерактивний звіт](index.html): виберіть підприємство, галузь або "
        "«На перевірку», перегляньте фрагмент обов’язків та оригінал вакансії. "
        "[CSV](vacancies.csv) містить усі рішення й попередні категорії; "
        "results.jsonl зберігає сирі відповіді JEV, розподіли ймовірностей та вхідні тексти.",
        "",
        "Цей звіт не підтверджує точність без ручної перевірки. Поточна діаграма сайту "
        "і її 100% БпЛА залишаються незмінними до окремого впровадження розмітки вакансій.",
        "",
        "## Повний прогін без запису в БД",
        "",
        "```powershell",
        "cd backend",
        ".venv\\Scripts\\python.exe scripts/classify_vacancies.py --all --output ../reports/jev-all",
        "```",
        "",
        "Повний режим читає всі сирі вакансії, включно з неактивними та дублями. "
        "Повторний запуск використовує локальний кеш лише за повного збігу тексту, "
        "категорій, моделі та версії запитань. Різні описи під однаковою назвою не об’єднуються.",
        "",
        "Схема API: [офіційна документація TypeSafe / JEV](https://docs.typesafe.ai/api).",
        "",
    ]
    if (output / "MANUAL_REVIEW.md").exists():
        markdown += [
            "## Контрольні приклади",
            "",
            "[Перевірка конкретних вакансій і неоднозначних рішень](MANUAL_REVIEW.md)",
            "",
        ]
    (output / "REPORT.md").write_text("\n".join(markdown), encoding="utf-8")
    review = []
    for row in results[:5000]:
        decisions = row.get("decisions", {})
        domain = decisions.get("domain", {})
        role = decisions.get("role", {})
        review.append(
            {
                "id": row["vacancy_id"],
                "companyId": row["card_id"],
                "company": row["company_name"],
                "title": row["title"],
                "url": row["url"],
                "old": row["old_domain"] or "none",
                "domain": domain.get("choice", "error"),
                "confidence": domain.get("confidence", 0),
                "role": role.get("choice", "error"),
                "roleConfidence": role.get("confidence", 0),
                "review": row["review"],
                "status": row["status"],
                "state": row["state"],
                "probabilities": domain.get("probabilities", {}),
                "truncated": row["truncated_fields"],
            }
        )
    labels = {
        code: domain_label(code)
        for code in {"none", "error", *manifest["questions"]["domain"]["criteria"]}
    }
    labels["error"] = "Помилка API"
    data = (
        json.dumps(
            {"rows": review, "companies": summaries, "labels": labels, "roles": ROLE_LABELS},
            ensure_ascii=False,
        )
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    html = TEMPLATE.replace("__DATA__", data).replace("__COUNT__", str(manifest["selected"]))
    html = html.replace("__SUCCESS__", str(manifest["success"])).replace(
        "__REVIEW__", str(manifest["review"])
    )
    html = html.replace("__MODEL__", escape(", ".join(manifest["models_returned"])))
    html = html.replace(
        "__MANUAL_REVIEW__",
        '<a href="MANUAL_REVIEW.md">Контрольні приклади Алабуги</a>'
        if (output / "MANUAL_REVIEW.md").exists()
        else "",
    )
    html = html.replace(
        "__SCOPE__",
        "усі сирі записи"
        if manifest["scope"] == "all_raw"
        else "усі активні вакансії підприємства без дублів"
        if manifest["scope"] == "company_full_active"
        else "вибірка різних професій",
    )
    html = html.replace("__SAMPLING_NOTE__", escape(sampling_note))
    html = html.replace("__COVERAGE__", escape(coverage_note))
    html = html.replace(
        "__TABLE_NOTE__",
        "У таблиці перші 5000 записів. Повні дані у CSV." if len(results) > 5000 else "",
    )
    (output / "index.html").write_text(html, encoding="utf-8")


TEMPLATE = r"""<!doctype html>
<html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JEV · Тестова розмітка вакансій</title>
<style>
:root{color-scheme:light;--bg:#e5e8dd;--paper:#f9faf6;--ink:#1d2219;--muted:#5c6556;--green:#4c6030;--line:#d9ded0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}
main{max-width:1360px;margin:auto;padding:32px 24px}h1{margin:8px 0;font-size:32px}h2{font-size:20px;margin:0 0 12px}h3{font-size:16px;margin:0 0 8px}p{margin:8px 0}a{color:var(--green);text-underline-offset:3px}
.badge{display:inline-block;border-radius:30px;padding:4px 12px;background:#dbe5ca;color:#334b16;font-weight:650;font-size:12px}
.lead{color:var(--muted);max-width:900px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.metric,.card,.tablebox{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:20px}.metric strong{display:block;font-size:32px}.metric span{color:var(--muted);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:20px 0}.cards article:only-child{grid-column:1/-1}.bar b{white-space:nowrap;font-variant-numeric:tabular-nums}.sub{font-size:12px;color:var(--muted)}.bar{display:grid;grid-template-columns:minmax(160px,1fr) 2fr 110px;gap:10px;align-items:center;font-size:13px;margin:9px 0}.track{height:8px;background:#e6eadf;border-radius:5px;overflow:hidden}.track i{display:block;height:100%;background:var(--green);border-radius:5px}.warn{background:#fbefd6;color:#795719}.filters{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.filters input,.filters select{font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;background:white;min-width:180px}.filters input{flex:1}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px;min-width:900px}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);white-space:nowrap}td:first-child{width:35%;min-width:260px}td:nth-child(2){min-width:145px}td:nth-child(3){min-width:170px}td:nth-child(4){min-width:140px}details{margin-top:8px;font-size:12px}summary{cursor:pointer;color:var(--green)}.excerpt{padding:10px;background:#edf0e7;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere;max-width:600px;max-height:350px;overflow:auto}.num{font-variant-numeric:tabular-nums;white-space:nowrap}.review{color:#906817;font-weight:650}.links button{font:inherit;padding:5px 12px;border:1px solid var(--line);border-radius:8px;background:white;color:var(--green);cursor:pointer}.links button:disabled{opacity:.4;cursor:default}.links{display:flex;gap:16px;flex-wrap:wrap}footer{margin:24px 0;color:var(--muted);font-size:12px}@media(max-width:750px){main{padding:20px 12px}h1{font-size:25px}.cards{grid-template-columns:1fr}.metric{padding:12px}.bar{grid-template-columns:minmax(130px,1fr) 1fr 90px}}
</style><main>
<span class="badge">Тестовий прогін · БД не змінена</span>
<h1>Як JEV розмітив вакансії</h1>
<p class="lead">Галузь конкретної роботи замість автоматичного успадкування галузі підприємства. Порівняй попередню категорію з рішенням JEV та перевір обов’язки й оригінал вакансії.</p>
<p class="sub">Модель: __MODEL__ · Обсяг: __SCOPE__</p>
<div class="metrics"><div class="metric"><strong>__COUNT__</strong><span>відібрано вакансій</span></div><div class="metric"><strong>__SUCCESS__</strong><span>отримано рішень</span></div><div class="metric"><strong>__REVIEW__</strong><span>на ручну перевірку</span></div></div>
<p class="card">__SAMPLING_NOTE__ Категорії взято з БД; будівництво, HR, охорона та загальне IT належать до «Цивільної діяльності». «Галузь не визначено» означає брак даних.</p>
<p class="sub">__COVERAGE__</p>
<section class="cards" id="companies"></section>
<section class="tablebox"><h2>Вакансії для рев’ю</h2><div class="links"><a href="vacancies.csv" download>Завантажити CSV</a><a href="REPORT.md">Повний звіт</a><a href="manifest.json">Методика й запитання</a>__MANUAL_REVIEW__</div>
<div class="filters"><input id="search" placeholder="Знайти професію або ID" aria-label="Пошук вакансії"><select id="company" aria-label="Підприємство"><option value="">Усі підприємства</option></select><select id="domain" aria-label="Галузь"><option value="">Усі галузі</option></select><select id="review" aria-label="Стан перевірки"><option value="">Усі рішення</option><option value="review">На перевірку</option><option value="changed">Змінилась галузь</option></select></div>
<div class="links"><button id="prev" type="button">← Попередні</button><span class="sub" id="count"></span><button id="next" type="button">Наступні →</button></div><p class="sub">__TABLE_NOTE__</p><div class="scroll"><table><thead><tr><th>Вакансія та обов’язки</th><th>Було: галузь підприємства</th><th>JEV: галузь вакансії</th><th>JEV: роль діяльності</th><th>Впевненість</th></tr></thead><tbody id="rows"></tbody></table></div></section>
<footer>Результат моделі потребує перевірки; confidence не є виміряною точністю. Розподіл імовірностей збережено в JSON. На сайті розмітку не застосовано. <a href="https://docs.typesafe.ai/api" target="_blank" rel="noopener noreferrer">Документація JEV</a>.</footer></main>
<script type="application/json" id="data">__DATA__</script><script>
const data=JSON.parse(document.getElementById('data').textContent),labels=data.labels;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>(100*n).toLocaleString('uk-UA',{maximumFractionDigits:1})+'%';
const safeUrl=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:'#'}catch{return '#'}};
document.getElementById('companies').innerHTML=Object.entries(data.companies).map(([id,c])=>`<article class="card"><h3><a href="http://127.0.0.1:5173/companies/${Number(id)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a></h3><p class="sub">${c.success}/${c.sample} рішень · ${c.changed} змін галузі · ${c.review} на перевірку</p>${Object.entries(c.domains).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<div class="bar"><span>${esc(labels[k])}</span><span class="track"><i style="width:${100*n/(c.success||1)}%"></i></span><b>${n} · ${pct(n/(c.success||1))}</b></div>`).join('')}</article>`).join('');
const company=document.getElementById('company'),domain=document.getElementById('domain'),review=document.getElementById('review'),search=document.getElementById('search');
Object.entries(data.companies).forEach(([id,c])=>company.insertAdjacentHTML('beforeend',`<option value="${Number(id)}">${esc(c.name)}</option>`));
[...new Set(data.rows.map(r=>r.domain))].sort().forEach(k=>domain.insertAdjacentHTML('beforeend',`<option value="${esc(k)}">${esc(labels[k]||k)}</option>`));
let page=0; const pageSize=50;
function render(){const query=search.value.toLocaleLowerCase();const rows=data.rows.filter(r=>(!company.value||String(r.companyId)===company.value)&&(!domain.value||r.domain===domain.value)&&(!query||r.title.toLocaleLowerCase().includes(query)||String(r.id).includes(query))&&(!review.value||(review.value==='review'?r.review:r.old!==r.domain)));page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1)); const start=page*pageSize; document.getElementById('count').textContent=`\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043e ${rows.length?start+1:0}\u2013${Math.min(start+pageSize,rows.length)} \u0456\u0437 ${rows.length} \u0432\u0456\u0434\u043f\u043e\u0432\u0456\u0434\u043d\u0438\u0445 \u00b7 \u0443\u0441\u044c\u043e\u0433\u043e ${data.rows.length}`;document.getElementById('prev').disabled=page===0;document.getElementById('next').disabled=start+pageSize>=rows.length;document.getElementById('rows').innerHTML=rows.slice(start,start+pageSize).map(r=>`<tr><td><b>${esc(r.title)}</b><div class="sub">${esc(r.company)} · ID ${r.id}</div><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">Оригінал вакансії ↗</a><details><summary>Переглянути текст і обов’язки</summary><div class="excerpt">${esc(Object.entries(r.state).map(([k,v])=>k+':\n'+v).join('\n\n'))}</div>${r.truncated.length?'<p class="review">Довгі поля скорочено: '+esc(r.truncated.join(', '))+'</p>':''}</details></td><td>${esc(labels[r.old]||r.old)}</td><td><b>${esc(labels[r.domain]||r.domain)}</b>${r.review?'<div class="review">На перевірку</div>':''}<details><summary>Імовірності галузей</summary>${Object.entries(r.probabilities).filter(([k,p])=>p>0.01).sort((a,b)=>b[1]-a[1]).map(([k,p])=>esc(labels[k]||k)+': '+pct(p)).join('<br>')}</details></td><td>${esc(data.roles[r.role]||r.role)}<div class="sub">${pct(r.roleConfidence)}</div></td><td class="num">${pct(r.confidence)}</td></tr>`).join('')};[company,domain,review,search].forEach(el=>el.addEventListener('input',()=>{page=0;render()}));document.getElementById('prev').addEventListener('click',()=>{page--;render()});document.getElementById('next').addEventListener('click',()=>{page++;render()});render();
</script></html>
"""
