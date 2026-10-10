"""Catch Russian narrative while allowing literal employer and vacancy names."""

import re


def russian_prose(value: str, literal_names=()) -> bool:
    for name in sorted(set(literal_names), key=len, reverse=True):
        if name:
            value = value.replace(name, "")
    value = re.sub(r"«[^»]*»|\"[^\"]*\"|https?://\S+|\[s\d+\]", "", value)
    return bool(
        re.search(
            r"[ыэъё]|\b(?:есть|это|найдена|найдено|вакансия|запросу|данные|показывают|"
            r"требования|снимок|года|подтверждает|которые|всего|производит|производства)\b",
            value,
            re.I,
        )
    )
