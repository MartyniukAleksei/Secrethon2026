"""Resolve explicit company names independently of the previously open card."""

import re

from app.search import fold, variants

GENERIC = set(
    "ооо оао пао зао ао тов ат прат концерн компания компанія предприятие підприємство "
    "завод заводы заводів группа група групп компаний компаній вакансии вакансії "
    "производство виробництво научный научно исследовательский институт центр "
    "федеральное государственное унитарное предприятие акционерное общество ".split()
)


def named_companies(question: str, rows: list[dict]) -> list[dict]:
    questions = [set(re.findall(r"\w+", value)) for value in variants(question)]
    found = []
    primary_tokens = []
    aliases = []
    for row in rows:
        names = [row["name"].split(".")[0], row.get("gur_name") or ""]
        for index, name in enumerate(names):
            tokens = set(re.findall(r"\w+", fold(name))) - GENERIC
            if not any(len(token) >= 2 for token in tokens):
                continue

            def mentions(words, tokens=tokens):
                return all(
                    any(
                        word == token
                        or word in {token + suffix for suffix in ("а", "у", "ом", "і", "е")}
                        or token.endswith("а")
                        and word in {token[:-1] + suffix for suffix in ("у", "и", "і", "е")}
                        for word in words
                    )
                    for token in tokens
                )

            if tokens and any(mentions(words) for words in questions):
                candidate = {"id": row["id"], "name": row["name"]}
                if index == 0:
                    found.append(candidate)
                    primary_tokens.append(tokens)
                else:
                    aliases.append((candidate, tokens))
                break
    # A short exact card name wins over the same shared GUR alias of its branches.
    for candidate, tokens in aliases:
        if tokens not in primary_tokens:
            found.append(candidate)
            primary_tokens.append(tokens)
    normalized_questions = [" ".join(re.findall(r"\w+", v)) for v in variants(question)]
    resolved = []
    for candidate, tokens in zip(found, primary_tokens, strict=True):
        # "НПО Алмаз" names one company; a shorter "АО Алмаз" match must not
        # pull a second company into this answer. Preserve explicitly named comparisons.
        full_name = " ".join(re.findall(r"\w+", fold(candidate["name"].split(".")[0])))
        explicit_full = any(f" {full_name} " in f" {q} " for q in normalized_questions)
        if not explicit_full and any(tokens < other for other in primary_tokens):
            continue
        resolved.append(candidate)
    return resolved


def proposes_web_search(text: str) -> bool:
    value = text.lower()
    need = r"(?:потріб\w*|необхід\w*|треба|можу|можна|потреб\w*|уточн\w*|перевір\w*)"
    web = r"(?:веб\w*|[іи]нтернет\w*|відкрит\w* джерел\w*|загальнодоступ\w*)"
    return bool(re.search(rf"{need}[^.!?\n]{{0,240}}{web}|{web}[^.!?\n]{{0,240}}{need}", value))
