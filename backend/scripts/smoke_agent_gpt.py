"""Check the configured GPT gateway/tool contract without connecting to a database."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent_provider import ProviderError, post_json  # noqa: E402
from app.api.agent import TOOLS, Finish  # noqa: E402
from app.config import settings  # noqa: E402


async def main():
    if not settings.gpt_api_key or not settings.gpt_base_url:
        raise SystemExit("GPT gateway configuration is missing")
    try:
        response = await post_json(
            settings.gpt_base_url.rstrip("/") + "/chat/completions",
            {
                "model": settings.gpt_model,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Виклич finish з текстом «Уточніть підприємство» та sections=[]; "
                            "це перевірка формату інструментів, дані не потрібні."
                        ),
                    }
                ],
                "tools": [{"type": "function", "function": TOOLS[-1]}],
                "tool_choice": "required",
                "parallel_tool_calls": False,
                "max_completion_tokens": 4096,
            },
            {"Authorization": "Bearer " + settings.gpt_api_key},
            "GPT",
        )
        call = response["choices"][0]["message"]["tool_calls"][0]
        assert call["id"] and call["function"]["name"] == "finish"
        Finish.model_validate(json.loads(call["function"]["arguments"]))
    except ProviderError as exc:
        raise SystemExit(
            f"GPT gateway check failed: status={exc.status}, reason={exc.reason}"
        ) from None
    except (KeyError, IndexError, TypeError, ValueError, AssertionError):
        raise SystemExit("GPT gateway returned an incompatible tool response") from None
    print(f"GPT gateway and function calling: OK ({settings.gpt_model}). No database connection.")


if __name__ == "__main__":
    asyncio.run(main())
