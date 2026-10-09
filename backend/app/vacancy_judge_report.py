"""Local GPT judge report with weighted and distinct-text metrics."""

# ruff: noqa: E501 -- HTML/JS and report text

import json
from collections import Counter
from html import escape

from app.vacancy_label_report import TEMPLATE as LABEL_TEMPLATE
from app.vacancy_labeling import ROLE_LABELS, domain_label

VERDICT_LABELS = {
    "supported": "Підтверджено",
    "incorrect": "Помилка за оцінкою GPT",
    "ambiguous": "Неоднозначно",
    "insufficient": "Бракує даних",
    "error": "Не оцінено: помилка API",
}


def metrics(rows):
    ok = [r for r in rows if r["status"] == "ok"]
    unique = {r["judge_group"]: r for r in ok}
    output = {
        "total": len(rows),
        "evaluated": len(ok),
        "errors": len(rows) - len(ok),
        "unique_texts_evaluated": len(unique),
        "vacancy": {},
        "unique_text": {},
    }
    for name, items in [("vacancy", ok), ("unique_text", list(unique.values()))]:
        section = output[name]
        for dim in ("domain", "role"):
            section[dim] = dict(Counter(r["audit"][dim]["verdict"] for r in items))
            section[dim + "_blind_agreement"] = sum(
                r["decisions"][dim]["choice"] == r["blind"][dim]["choice"] for r in items
            )
        section["both_supported"] = sum(
            all(r["audit"][d]["verdict"] == "supported" for d in ("domain", "role")) for r in items
        )
        section["any_incorrect"] = sum(
            any(r["audit"][d]["verdict"] == "incorrect" for d in ("domain", "role")) for r in items
        )
    output["jev_domains"] = dict(Counter(r["decisions"]["domain"]["choice"] for r in rows))
    output["gpt_blind_domains"] = dict(Counter(r["blind"]["domain"]["choice"] for r in ok))
    output["high_confidence_errors"] = sum(
        any(
            r["audit"][d]["verdict"] == "incorrect" and r["decisions"][d]["confidence"] >= 0.9
            for d in ("domain", "role")
        )
        for r in ok
    )
    output["missed_by_jev_review_flag"] = sum(
        not r["jev_review"]
        and any(r["audit"][d]["verdict"] == "incorrect" for d in ("domain", "role"))
        for r in ok
    )
    output["error_transitions"] = {}
    for dim in ("domain", "role"):
        wrong = [r for r in ok if r["audit"][dim]["verdict"] == "incorrect"]
        transitions = Counter(
            (r["decisions"][dim]["choice"], r["audit"][dim]["suggested_choice"]) for r in wrong
        )
        output["error_transitions"][dim] = [
            {
                "from": origin,
                "to": target,
                "vacancies": count,
                "unique_texts": len(
                    {
                        r["judge_group"]
                        for r in wrong
                        if r["decisions"][dim]["choice"] == origin
                        and r["audit"][dim]["suggested_choice"] == target
                    }
                ),
            }
            for (origin, target), count in transitions.most_common()
        ]
    return output


def percent(n, total):
    return f"{100 * n / total:.1f}%" if total else "—"


def write_report(output, manifest, rows):
    summary = metrics(rows)
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md = [
        "# GPT as a judge: рев’ю JEV на вакансіях Алабуги",
        "",
        "**Результати збережено локально. БД не читалася і не змінювалася цим рев’ю; використано попередній повний експорт.**",
        "",
        f"Модель: {', '.join(manifest['models_returned'])}. Оцінено {summary['evaluated']} із {manifest['source_vacancies']} вакансій; помилок {summary['errors']}. "
        f"Різних повних текстів оцінено {summary['unique_texts_evaluated']}.",
        "",
        "## Методика",
        "",
        "1. GPT незалежно розмічає текст вакансії без міток і confidence JEV та без окремого профілю роботодавця. Реклама підприємства в описі не вважається обов’язками вакансії.",
        "2. GPT оцінює кандидатні мітки за тим самим довідником і обов’язками. Сліпа відповідь показана як додаткова перевірка, а не еталон. Кандидат не підписаний назвою моделі. Усі різні тексти проходять обидва етапи, навіть коли класифікації збігаються.",
        "3. Підтвердження, помилка, неоднозначність і брак даних рахуються окремо для галузі й ролі. Пояснення містять цитати, наявність яких перевірена у вхідному тексті.",
        "4. Точні копії повного вхідного тексту використовують спільну оцінку; різні описи тієї самої посади не об’єднуються. Підсумки наведені і за всіма вакансіями, і за різними текстами, щоб часті посади не приховували проблем рідкісних.",
        "",
        "**Це оцінка GPT, а не виміряна точність на людській еталонній розмітці. Обидва етапи виконує та сама модель; вони не є двома незалежними суддями.** Рев’ю перевіряє відповідність початковому довіднику, а не правильність самого довідника. Зокрема будівництво і HR згруповані у цивільну діяльність.",
        "",
        "## Оцінка за всіма вакансіями",
        "",
        "| Оцінка GPT | Галузь | Частка | Роль | Частка |",
        "|---|---:|---:|---:|---:|",
    ]
    for verdict, label in VERDICT_LABELS.items():
        if verdict == "error":
            continue
        domain = summary["vacancy"]["domain"].get(verdict, 0)
        role = summary["vacancy"]["role"].get(verdict, 0)
        md.append(
            f"| {label} | {domain} | {percent(domain, summary['evaluated'])} | {role} | {percent(role, summary['evaluated'])} |"
        )
    md += [
        "",
        f"Підтверджено обидва виміри: {summary['vacancy']['both_supported']} ({percent(summary['vacancy']['both_supported'], summary['evaluated'])}). "
        f"Принаймні одна помилка за оцінкою GPT: {summary['vacancy']['any_incorrect']}.",
        "",
        f"Вакансій із помилкою за оцінкою GPT при confidence JEV ≥90%: {summary['high_confidence_errors']}. "
        f"Помилок, не позначених початковим прапорцем review JEV: {summary['missed_by_jev_review_flag']}.",
        "",
        "## Різні повні тексти",
        "",
        "| Оцінка GPT | Галузь | Роль |",
        "|---|---:|---:|",
    ]
    for verdict, label in VERDICT_LABELS.items():
        if verdict != "error":
            md.append(
                f"| {label} | {summary['unique_text']['domain'].get(verdict, 0)} | {summary['unique_text']['role'].get(verdict, 0)} |"
            )
    md += [
        "",
        "## Збіг із незалежною розміткою",
        "",
        f"Галузь: {summary['vacancy']['domain_blind_agreement']}/{summary['evaluated']} "
        f"({percent(summary['vacancy']['domain_blind_agreement'], summary['evaluated'])}); "
        f"роль: {summary['vacancy']['role_blind_agreement']}/{summary['evaluated']} "
        f"({percent(summary['vacancy']['role_blind_agreement'], summary['evaluated'])}). "
        "Це збіг моделей, а не точність. Розбіжність не завжди є помилкою.",
        "",
        "## Розподіл галузей: JEV та незалежний GPT",
        "",
        "Це дві модельні розмітки; пропозиції GPT не застосовано до БД.",
        "",
        "| Галузь | JEV | Частка | Незалежний GPT | Частка |",
        "|---|---:|---:|---:|---:|",
    ]
    codes = set(summary["jev_domains"]) | set(summary["gpt_blind_domains"])
    for code in sorted(codes, key=lambda c: -summary["jev_domains"].get(c, 0)):
        a, b = summary["jev_domains"].get(code, 0), summary["gpt_blind_domains"].get(code, 0)
        md.append(
            f"| {domain_label(code)} | {a} | {percent(a, summary['total'])} | {b} | {percent(b, summary['evaluated'])} |"
        )
    md += [
        "",
        "## Найчастіші виправлення, запропоновані GPT",
        "",
        "Це пропозиції для ручного рев’ю випадків з оцінкою «помилка», а не застосовані виправлення.",
        "",
        "| Вимір | Мітка JEV → пропозиція GPT | Вакансій | Різних текстів |",
        "|---|---|---:|---:|",
    ]
    for dim in ("domain", "role"):
        label = domain_label if dim == "domain" else lambda c: ROLE_LABELS.get(c, c)
        for transition in summary["error_transitions"][dim][:10]:
            md.append(
                f"| {'Галузь' if dim == 'domain' else 'Роль'} | "
                f"{label(transition['from'])} → {label(transition['to'])} | "
                f"{transition['vacancies']} | {transition['unique_texts']} |"
            )
    examples = {}
    for row in rows:
        if row["status"] == "ok" and any(
            d["verdict"] == "incorrect" for d in row["audit"].values()
        ):
            examples.setdefault(row["judge_group"], row)
    md += ["", "## Приклади розбіжностей для ручної перевірки", ""]
    for row in list(examples.values())[:12]:
        md += [f"### ID {row['vacancy_id']}: {row['title']}", ""]
        for dim in ("domain", "role"):
            decision = row["audit"][dim]
            if decision["verdict"] == "incorrect":
                label = domain_label if dim == "domain" else lambda c: ROLE_LABELS.get(c, c)
                md.append(
                    f"- {dim}: {label(row['decisions'][dim]['choice'])} → {label(decision['suggested_choice'])}. {decision['reason']}"
                )
                md.append(f"  Цитата: {decision['evidence']}")
        md.append("")
    md += [
        "## Файли",
        "",
        "[Інтерактивний звіт](index.html) · [Усі оцінки й пояснення CSV](review.csv) · [Метрики JSON](summary.json). "
        "responses.jsonl містить сирі відповіді обох етапів, results.json — оцінку для кожної вакансії. manifest.json фіксує джерело, модель, довідник і покриття.",
        "",
        "Методика спирається на [OpenAI: evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices) "
        "та [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).",
        "",
    ]
    (output / "REPORT.md").write_text("\n".join(md), encoding="utf-8")
    display_rows = [
        {
            "id": r["vacancy_id"],
            "title": r["title"],
            "url": r["url"],
            "status": r["status"],
            "state": r["state"],
            "jev": r["decisions"],
            "blind": r.get("blind", {}),
            "audit": r.get("audit", {}),
            "jevReview": r["jev_review"],
        }
        for r in rows
    ]
    data = json.dumps(
        {
            "rows": display_rows,
            "metrics": summary,
            "verdicts": VERDICT_LABELS,
            "domains": {c: domain_label(c) for c in manifest["rubric"]["domain"]["criteria"]},
            "roles": ROLE_LABELS,
        },
        ensure_ascii=False,
    ).replace("<", "\\u003c")
    css = LABEL_TEMPLATE.split("<style>")[1].split("</style>")[0]
    html = TEMPLATE.replace("__CSS__", css).replace("__DATA__", data)
    html = html.replace(
        "__SOURCE_DESCRIPTION__",
        escape(
            f"Алабуга: пробний прогін {len(rows)} вакансій із повного експорту "
            f"{manifest['source_vacancies']} активних вакансій без дублів."
            if manifest.get("limit_unique_texts")
            else f"Алабуга: всі {manifest['source_vacancies']:,} активні вакансії без дублів."
        ),
    )
    for key, value in {
        "MODEL": ", ".join(manifest["models_returned"]),
        "TOTAL": summary["evaluated"],
        "SUPPORTED": summary["vacancy"]["both_supported"],
        "INCORRECT": summary["vacancy"]["any_incorrect"],
    }.items():
        html = html.replace("__" + key + "__", escape(str(value)))
    (output / "index.html").write_text(html, encoding="utf-8")


TEMPLATE = r"""<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Алабуга · GPT рев’ю JEV</title><style>__CSS__
.cards{grid-template-columns:1fr 1fr}.metrics{grid-template-columns:repeat(3,1fr)}.summary td:first-child{width:auto;min-width:0}table.summary{min-width:0}.bad{color:#9d3929;font-weight:650}.good{color:#4c6030;font-weight:650}@media(max-width:750px){.cards{grid-template-columns:1fr}}
</style><main><span class="badge">LLM as a judge · БД не змінена</span><h1>Як GPT оцінив розмітку JEV</h1><p class="lead">__SOURCE_DESCRIPTION__ Спочатку незалежна класифікація без відповідей JEV, потім перевірка кандидатних міток за обов’язками.</p><p class="sub">Модель: __MODEL__ · Оцінка моделі, а не точність на людському еталоні</p>
<div class="metrics"><div class="metric"><strong>__TOTAL__</strong><span>вакансій оцінено</span></div><div class="metric"><strong>__SUPPORTED__</strong><span>обидві мітки підтверджено GPT</span></div><div class="metric"><strong>__INCORRECT__</strong><span>є помилка за оцінкою GPT</span></div></div>
<section class="card"><h2>Оцінка за всіма вакансіями</h2><table class="summary"><thead><tr><th>Висновок GPT</th><th>Галузь</th><th>Роль діяльності</th></tr></thead><tbody id="metrics"></tbody></table><p id="agreement" class="sub"></p><p id="coverage" class="sub"></p><p class="sub">Точні копії тексту мають спільну оцінку; їхні результати враховано для кожної вакансії. Неоднозначні випадки й брак даних не зараховано до підтверджених помилок.</p></section>
<section class="cards" id="distributions"></section><section class="tablebox"><h2>Рев’ю конкретних вакансій</h2><div class="links"><a href="review.csv" download>Завантажити CSV</a><a href="REPORT.md">Повний звіт і приклади</a><a href="summary.json">Метрики</a><a href="manifest.json">Методика</a></div>
<div class="filters"><input id="search" aria-label="Пошук вакансії" placeholder="Назва професії або ID"><select id="verdict" aria-label="Висновок GPT"><option value="">Усі висновки</option><option value="incorrect">Є помилка за оцінкою GPT</option><option value="ambiguous">Неоднозначні</option><option value="insufficient">Бракує даних</option><option value="supported">Обидві мітки підтверджено</option><option value="error">Не оцінено</option></select><select id="domain" aria-label="Галузь JEV"><option value="">Усі галузі JEV</option></select></div><div class="links"><button id="prev">← Попередні</button><span id="count" class="sub"></span><button id="next">Наступні →</button></div><div class="scroll"><table><thead><tr><th>Вакансія та текст</th><th>Галузь JEV → GPT</th><th>Оцінка галузі</th><th>Роль JEV → GPT</th><th>Оцінка ролі</th></tr></thead><tbody id="rows"></tbody></table></div></section><footer>Пропозиції GPT збережено для рев’ю. Не застосовано до БД. Обидва етапи виконує одна модель; для перевірки точності потрібна людська еталонна розмітка.</footer></main>
<script type="application/json" id="data">__DATA__</script><script>
const data=JSON.parse(document.getElementById('data').textContent),m=data.metrics;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(n,d)=>d?(100*n/d).toLocaleString('uk-UA',{maximumFractionDigits:1})+'%':'—';
const safeUrl=s=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:'#'}catch{return '#'}};
document.getElementById('metrics').innerHTML=['supported','incorrect','ambiguous','insufficient'].map(k=>`<tr><td>${esc(data.verdicts[k])}</td><td>${m.vacancy.domain[k]||0} · ${pct(m.vacancy.domain[k]||0,m.evaluated)}</td><td>${m.vacancy.role[k]||0} · ${pct(m.vacancy.role[k]||0,m.evaluated)}</td></tr>`).join('');
document.getElementById('agreement').textContent=`Збіг JEV з незалежним GPT: галузь ${pct(m.vacancy.domain_blind_agreement,m.evaluated)}, роль ${pct(m.vacancy.role_blind_agreement,m.evaluated)}. Це збіг моделей, а не точність.`;
document.getElementById('coverage').textContent=`Оцінено ${m.evaluated} із ${m.total}; різних текстів ${m.unique_texts_evaluated}; помилок API ${m.errors}. Помилок при confidence JEV ≥90%: ${m.high_confidence_errors} вакансій.`;
document.getElementById('distributions').innerHTML=[['Розмітка JEV',m.jev_domains,m.total],['Незалежна розмітка GPT',m.gpt_blind_domains,m.evaluated]].map(([title,counts,total])=>`<article class="card"><h3>${esc(title)}</h3><p class="sub">Модельні рішення; до БД не застосовано</p>${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([code,n])=>`<div class="bar"><span>${esc(data.domains[code]||code)}</span><span class="track"><i style="width:${100*n/(total||1)}%"></i></span><b>${n} · ${pct(n,total)}</b></div>`).join('')}</article>`).join('');
const search=document.getElementById('search'),verdict=document.getElementById('verdict'),domain=document.getElementById('domain');let page=0;const size=50;
Object.entries(data.domains).forEach(([k,v])=>domain.insertAdjacentHTML('beforeend',`<option value="${esc(k)}">${esc(v)}</option>`));
function evaluation(r,dim){const a=r.audit[dim];if(!a)return esc(data.verdicts.error);const label=dim==='domain'?data.domains:data.roles;return `<b class="${a.verdict==='incorrect'?'bad':a.verdict==='supported'?'good':'review'}">${esc(data.verdicts[a.verdict])}</b><p>${esc(a.reason)}</p><details><summary>Цитата та пропозиція</summary><div class="excerpt">${esc(a.evidence||'Немає достатніх даних')}</div><p>Пропозиція GPT: ${esc(label[a.suggested_choice]||a.suggested_choice)}</p></details>`}
function render(){const q=search.value.toLocaleLowerCase();const rows=data.rows.filter(r=>(!q||r.title.toLocaleLowerCase().includes(q)||String(r.id).includes(q))&&(!domain.value||r.jev.domain.choice===domain.value)&&(!verdict.value||(verdict.value==='error'?r.status!=='ok':verdict.value==='supported'?r.status==='ok'&&['domain','role'].every(d=>r.audit[d].verdict==='supported'):r.status==='ok'&&['domain','role'].some(d=>r.audit[d].verdict===verdict.value))));page=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));const start=page*size;document.getElementById('count').textContent=`Показано ${rows.length?start+1:0}–${Math.min(start+size,rows.length)} із ${rows.length} відповідних · усього ${data.rows.length}`;document.getElementById('prev').disabled=page===0;document.getElementById('next').disabled=start+size>=rows.length;document.getElementById('rows').innerHTML=rows.slice(start,start+size).map(r=>`<tr><td><b>${esc(r.title)}</b><p class="sub">ID ${r.id}${r.jevReview?' · JEV позначив для рев’ю':''}</p><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">Оригінал вакансії ↗</a><details><summary>Переглянути обов’язки</summary><div class="excerpt">${esc(Object.entries(r.state).map(([k,v])=>k+':\n'+v).join('\n\n'))}</div></details></td><td>${esc(data.domains[r.jev.domain.choice])}<p class="sub">confidence JEV ${pct(r.jev.domain.confidence,1)}</p><b>→ ${esc(data.domains[r.blind.domain?.choice]||'Не оцінено')}</b><p class="sub">Незалежний GPT</p></td><td>${evaluation(r,'domain')}</td><td>${esc(data.roles[r.jev.role.choice])}<p class="sub">confidence JEV ${pct(r.jev.role.confidence,1)}</p><b>→ ${esc(data.roles[r.blind.role?.choice]||'Не оцінено')}</b><p class="sub">Незалежний GPT</p></td><td>${evaluation(r,'role')}</td></tr>`).join('')};[search,verdict,domain].forEach(e=>e.addEventListener('input',()=>{page=0;render()}));document.getElementById('prev').addEventListener('click',()=>{page--;render()});document.getElementById('next').addEventListener('click',()=>{page++;render()});render();
</script></html>"""
