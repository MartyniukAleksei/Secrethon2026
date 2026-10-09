import asyncio
import copy
import json

import pytest

from app import vacancy_judge
from app.config import Settings
from app.vacancy_judge import parse_response, payload, source_lines
from app.vacancy_judge_report import metrics
from app.vacancy_labeling import questions

STATE = {"title": "Инженер", "description": "Оpгaнизaция темaтичeскиx нeдель\nЗбирання БпЛА"}
QUESTIONS = questions(["civil_other", "uav"], ["services", "manufacturer"])


def response(stage="blind"):
    decision = (
        {"choice": "uav", "certainty": "high"}
        if stage == "blind"
        else {"suggested_choice": "uav", "verdict": "supported"}
    )
    body = {
        dim: {**decision, "reason": "Є явні обов’язки.", "evidence_line": 3}
        for dim in ("domain", "role")
    }
    body["role"]["choice" if stage == "blind" else "suggested_choice"] = "manufacturer"
    return {
        "model": "gpt-test",
        "choices": [
            {"finish_reason": "stop", "message": {"content": json.dumps(body, ensure_ascii=False)}}
        ],
    }


def test_blind_phase_does_not_expose_jev_decisions_or_confidence():
    content = json.loads(payload(STATE, QUESTIONS, "blind")["messages"][1]["content"])
    assert set(content) == {"rubric", "vacancy"}
    assert "candidate" not in content and "confidence" not in json.dumps(content)


def test_source_line_reference_preserves_mixed_script_original():
    original = source_lines(STATE)[1]["text"]
    r = response()
    body = json.loads(r["choices"][0]["message"]["content"])
    body["domain"]["evidence_line"] = 2
    r["choices"][0]["message"]["content"] = json.dumps(body)
    assert parse_response(r, QUESTIONS, STATE, "blind")["domain"]["evidence"] == original


def test_compact_request_removes_only_exact_repetitions_without_losing_source_lines():
    state = {
        "title": "Інженер",
        "responsibilities": "Збирання БпЛА\nВипробування",
        "description": "Збирання БпЛА\nВипробування\nДодаткові обов’язки",
    }
    content = json.loads(payload(state, QUESTIONS, "blind")["messages"][1]["content"])
    assert len(content["vacancy"]) == 4
    assert {line[2] for line in content["vacancy"]} == {
        line["text"] for line in source_lines(state)
    }
    for ident, field, text in content["vacancy"]:
        assert source_lines(state)[ident - 1] == {"line_id": ident, "field": field, "text": text}


@pytest.mark.parametrize("line", [-1, 999, True, 0])
def test_invalid_or_missing_evidence_not_accepted_for_a_positive_category(line):
    r = response()
    body = json.loads(r["choices"][0]["message"]["content"])
    body["domain"]["evidence_line"] = line
    r["choices"][0]["message"]["content"] = json.dumps(body)
    with pytest.raises(ValueError):
        parse_response(r, QUESTIONS, STATE, "blind")


def test_truncated_or_refused_output_is_not_a_review():
    r = response()
    r["choices"][0]["finish_reason"] = "length"
    with pytest.raises(ValueError):
        parse_response(r, QUESTIONS, STATE, "blind")
    r["choices"][0]["finish_reason"] = "stop"
    r["choices"][0]["message"]["refusal"] = "refused"
    with pytest.raises(ValueError):
        parse_response(r, QUESTIONS, STATE, "blind")


def test_audit_cannot_support_a_different_label_or_call_same_label_incorrect():
    r = response("audit")
    with pytest.raises(ValueError):
        parse_response(r, QUESTIONS, STATE, "audit", {"domain": "civil_other", "role": "services"})
    body = json.loads(r["choices"][0]["message"]["content"])
    body["domain"]["verdict"] = "incorrect"
    r["choices"][0]["message"]["content"] = json.dumps(body)
    with pytest.raises(ValueError):
        parse_response(r, QUESTIONS, STATE, "audit", {"domain": "uav", "role": "manufacturer"})


def test_weighted_metrics_and_unique_text_metrics_do_not_treat_ambiguity_as_errors():
    base = {
        "status": "ok",
        "judge_group": "same-text",
        "jev_review": False,
        "decisions": {d: {"choice": "none", "confidence": 1} for d in ("domain", "role")},
        "blind": {d: {"choice": "none"} for d in ("domain", "role")},
        "audit": {d: {"verdict": "ambiguous"} for d in ("domain", "role")},
    }
    other = copy.deepcopy(base)
    other["judge_group"] = "different-text"
    other["audit"]["domain"]["verdict"] = "incorrect"
    other["audit"]["domain"]["suggested_choice"] = "uav"
    result = metrics([base, copy.deepcopy(base), other])
    assert result["vacancy"]["domain"] == {"ambiguous": 2, "incorrect": 1}
    assert result["unique_text"]["domain"] == {"ambiguous": 1, "incorrect": 1}
    assert result["vacancy"]["any_incorrect"] == 1
    assert result["vacancy"]["both_supported"] == 0
    assert result["high_confidence_errors"] == 1
    assert result["error_transitions"]["domain"] == [
        {"from": "none", "to": "uav", "vacancies": 1, "unique_texts": 1}
    ]


@pytest.mark.parametrize("name", ["GPT_API_KEY", "TEAM_API_KEY", "TEAM_KEY_GPT"])
def test_team_key_aliases_load_without_sharing_other_service_keys(monkeypatch, name):
    for key in ["GPT_API_KEY", "TEAM_API_KEY", "TEAM_KEY_GPT"]:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv(name, "judge-test-key")
    configured = Settings(_env_file=None)
    assert configured.gpt_api_key == "judge-test-key"


def test_small_output_reserve_falls_back_to_original_ceiling_on_truncation(monkeypatch):
    limits = []

    async def fake_post(url, body, headers, provider):
        limits.append(body["max_completion_tokens"])
        result = response()
        if len(limits) == 1:
            result["choices"][0]["finish_reason"] = "length"
        return result

    monkeypatch.setattr(vacancy_judge, "post_json", fake_post)
    monkeypatch.setattr(vacancy_judge.settings, "gpt_api_key", "test-gpt-key")
    monkeypatch.setattr(vacancy_judge.settings, "gpt_base_url", "https://example.com/v1")
    result, parsed = asyncio.run(
        vacancy_judge.request(payload(STATE, QUESTIONS, "blind"), QUESTIONS, STATE, "blind")
    )
    assert limits == [1500, 3000]
    assert result["_judge_transport_max_completion_tokens"] == 3000
    assert parsed["domain"]["choice"] == "uav"
