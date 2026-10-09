"""Search that forgives the alphabet: Ukrainian letters, Latin transliteration, ё.

Names are stored in Russian. A query in Ukrainian ("Калашніков") or Latin ("Kalashnikov")
is brought to the same form: lowercase, Ukrainian і/ї/є/ґ and ё folded into и/е/г/е, and
Latin transliterated into Cyrillic. Both the query as typed and its transliteration are tried.
"""

# Applied to the stored text in SQL, so both sides are folded the same way.
FOLD_FROM = "іїєґё"
FOLD_TO = "ииеге"
FOLD_TABLE = str.maketrans(FOLD_FROM, FOLD_TO)

# Longest first: "shch" before "sh" before "s".
LATIN = [
    ("shch", "щ"), ("sch", "щ"), ("kh", "х"), ("zh", "ж"), ("ts", "ц"), ("ch", "ч"),
    ("sh", "ш"), ("yu", "ю"), ("ya", "я"), ("yo", "е"), ("ye", "е"),
    ("a", "а"), ("b", "б"), ("c", "к"), ("d", "д"), ("e", "е"), ("f", "ф"), ("g", "г"),
    ("h", "х"), ("i", "и"), ("j", "й"), ("k", "к"), ("l", "л"), ("m", "м"), ("n", "н"),
    ("o", "о"), ("p", "п"), ("q", "к"), ("r", "р"), ("s", "с"), ("t", "т"), ("u", "у"),
    ("v", "в"), ("w", "в"), ("x", "кс"), ("z", "з"),
]  # fmt: skip


def fold(text: str) -> str:
    return text.lower().translate(FOLD_TABLE).replace('"', "").replace("«", "").replace("»", "")


def _translit(text: str, y: str) -> str:
    out, i = [], 0
    while i < len(text):
        for latin, cyr in LATIN:
            if text.startswith(latin, i):
                out.append(cyr)
                i += len(latin)
                break
        else:
            out.append(y if text[i] == "y" else text[i])
            i += 1
    return "".join(out)


def variants(query: str) -> list[str]:
    """The folded query and, when it has Latin letters, its Cyrillic readings (y as ы and й)."""
    q = fold(query.strip())
    found = [q]
    if any("a" <= ch <= "z" for ch in q):
        found += [_translit(q, "ы"), _translit(q, "й")]
    return list(dict.fromkeys(v for v in found if v))


def sql_fold(column: str) -> str:
    """The same folding of a stored column, for `ILIKE ANY(:variants)`."""
    return f"translate(lower({column}), '{FOLD_FROM}\"«»', '{FOLD_TO}')"
