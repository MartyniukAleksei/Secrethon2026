import json

from app.vacancy_label_report import company_summary, write_report


def record(ident, domain):
    return {
        "vacancy_id": ident,
        "card_id": 4064,
        "company_name": "Алабуга",
        "title": "Однакова назва посади",
        "url": "https://example.com/vacancy",
        "old_domain": "uav",
        "status": "ok",
        "review": False,
        "truncated_fields": [],
        "state": {"title": "</script><script>alert(1)</script>"},
        "decisions": {
            "domain": {"choice": domain, "confidence": 1, "probabilities": {domain: 1}},
            "role": {"choice": "services", "confidence": 1},
        },
    }


def test_distribution_counts_vacancies_even_when_profession_names_repeat():
    rows = [record(1, "uav"), record(2, "civil_other"), record(3, "civil_other")]
    summary = company_summary(rows)[4064]
    assert summary["success"] == 3
    assert summary["domains"] == {"uav": 1, "civil_other": 2}


def test_full_company_report_can_review_vacancies_beyond_the_old_2000_record_cap(tmp_path):
    rows = [record(i, "civil_other") for i in range(1, 2002)]
    manifest = {
        "scope": "company_full_active",
        "database_inventory": {
            "as_of": "2026-10-09",
            "total": 2001,
            "active": 2001,
            "unique_active": 2001,
        },
        "models_returned": ["jev-test"],
        "selected": 2001,
        "success": 2001,
        "errors": 0,
        "review": 0,
        "threshold": 0.75,
        "questions": {"domain": {"criteria": {"civil_other": "Civil work"}}},
    }
    write_report(tmp_path, manifest, rows)
    html = (tmp_path / "index.html").read_text(encoding="utf-8")
    payload = html.split('<script type="application/json" id="data">')[1].split("</script>")[0]
    embedded = json.loads(payload)
    assert len(embedded["rows"]) == 2001
    assert embedded["rows"][-1]["id"] == 2001
    assert "</script>" not in payload
    markdown = (tmp_path / "REPORT.md").read_text(encoding="utf-8")
    assert "без вибірки за професіями" in markdown
    assert "Пілот: по одній" not in markdown
