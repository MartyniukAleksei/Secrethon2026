import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app import embeddings, rag
from app.agent_input import model_messages
from app.api import agent
from app.api.agent import Context, Run
from app.rag_documents import Document, chunks, research_documents


@pytest.mark.parametrize("value", [[0, 0], [True, 1], [float("nan"), 1], [1]])
def test_reject_invalid_vectors(value):
    with pytest.raises(embeddings.EmbeddingUnavailable):
        embeddings.validate_vector(value, 2)


def test_normalizes_vectors():
    assert embeddings.validate_vector([3, 4], 2) == [0.6, 0.8]


def test_chunks_preserve_words_and_overlap():
    body = " ".join(f"word{n}" for n in range(1000))
    values = chunks(body)
    assert max(map(len, values)) <= 900
    assert set(body.split()) <= set(" ".join(values).split())
    assert values[0][-60:] in values[1]


def test_storage_approval_does_not_verify_web():
    record = {"id": "r1", "title": "Research", "employer_id": 41, "response": {
        "sources": [{"id": "s9", "url": "https://example.com", "origin": "public_web",
                     "verification": "unverified"}],
        "sections": [{"kind": "public_web", "text": "Claim [s9]"},
                     {"kind": "analysis", "text": "Inference [s9]"}],
    }}
    docs = research_documents(record)
    assert len(docs) == 1
    assert docs[0].verification == "unverified"
    record["response"]["sources"][0]["verification"] = "user_verified"
    assert research_documents(record)[0].verification == "user_verified"


def test_unchanged_index_does_not_embed_or_write(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(rag, "embed", mock)
    doc = Document("d1", 41, "Title", "Body", "/companies/41")
    assert asyncio.run(rag.index_documents([doc], {"d1": doc.fingerprint})) == 0
    mock.assert_not_called()


def test_failed_embedding_does_not_replace_existing_data(monkeypatch):
    mock = AsyncMock(side_effect=embeddings.EmbeddingUnavailable("unavailable"))
    monkeypatch.setattr(rag, "embed", mock)
    doc = Document("d1", 41, "Title", "Body", "/companies/41")
    with pytest.raises(embeddings.EmbeddingUnavailable):
        asyncio.run(rag.index_documents([doc], {"d1": "old"}))


def test_missing_index_does_not_call_paid_provider(monkeypatch):
    monkeypatch.setattr(rag, "ready", AsyncMock(return_value=False))
    mock = AsyncMock()
    monkeypatch.setattr(rag, "embed", mock)
    assert asyncio.run(rag.retrieve(object(), "products", 41)) == []
    mock.assert_not_called()


def test_knowledge_remaps_saved_citations_and_retains_verification(monkeypatch):
    monkeypatch.setattr(rag, "retrieve", AsyncMock(return_value=[{
        "employer_id": 41, "title": "Research", "body": "Claim [s9]",
        "url": "https://example.com", "origin": "public_web", "verification": "unverified",
        "metadata": {"sources": [{"id": "s9", "title": "Source",
            "url": "https://example.com", "origin": "public_web", "verification": "unverified"}]},
    }]))
    run = Run(object(), Context())
    values = asyncio.run(run.knowledge("products", 41))
    assert values[0]["text"] == "Claim [s1]"
    assert values[0]["verification"] == "unverified"
    assert run.sources["s1"]["verification"] == "unverified"


def test_shared_web_url_cannot_upgrade_an_unverified_claim():
    run = Run(None, Context())
    ident = run.source("Claim", "https://example.com", origin="public_web",
                       verification="unverified")
    assert run.source("Other claim", "https://example.com", origin="public_web",
                      verification="user_verified") == ident
    assert run.sources[ident]["verification"] == "unverified"


def test_relevant_passages_survive_profile_compaction():
    knowledge = [{"text": "Relevant fact " * 30, "source_ids": ["s1"]}]
    messages = [{"role": "system", "content": "Rules"}, {"role": "user", "content": "Products?"},
                {"role": "tool", "content": json.dumps({"profile": {"unused": "x" * 5000},
                                                       "knowledge": knowledge})}]
    result = model_messages(messages, [], max_bytes=1000)
    assert json.loads(result[-1]["content"])["knowledge"] == knowledge


def test_repeated_knowledge_has_one_shared_budget():
    knowledge = [{"employer_id": 41, "text": "Relevant fact " * 100, "source_ids": ["s1"]}]
    messages = [{"role": "system", "content": "Rules"}, {"role": "user", "content": "Products?"},
                *[{"role": "tool", "content": json.dumps({"knowledge": knowledge})}
                  for _ in range(5)]]
    result = model_messages(messages, [])
    excerpts = [item for message in result[2:]
                for item in json.loads(message["content"])["knowledge"]]
    assert excerpts == knowledge


def test_embedding_response_order_and_dimensions(monkeypatch):
    monkeypatch.setattr(embeddings.settings, "embedding_api_key", "fixture")
    monkeypatch.setattr(embeddings.settings, "rag_provider", "openai")
    monkeypatch.setattr(embeddings.settings, "rag_dimensions", 2)
    mock = AsyncMock(return_value={"data": [
        {"index": 1, "embedding": [0, 1]}, {"index": 0, "embedding": [1, 0]},
    ]})
    monkeypatch.setattr(embeddings, "post_json", mock)
    assert asyncio.run(embeddings.embed(["first", "second"])) == [[1, 0], [0, 1]]


def test_finish_preserves_main_facts_when_section_only_has_a_caveat(monkeypatch):
    from test_agent import response

    async def overview(self, name, raw):
        self.source("Database", "/")
        return {"source_id": "s1"}

    fact = "The company produces engines and machine tools according to the database [s1]."
    provider = AsyncMock(side_effect=[response("overview", {}), response("finish", {
        "text": fact, "source_ids": ["s1"],
        "sections": [{"kind": "database", "text": "Snapshot only.", "source_ids": ["s1"]}],
    })])
    monkeypatch.setattr(agent, "post_json", provider)
    monkeypatch.setattr(Run, "tool", overview)
    result = asyncio.run(agent.answer(agent.ChatIn(message="Products?"), None))
    assert fact in result["text"]
    assert fact in result["sections"][0]["text"]
