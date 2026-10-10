"""Configurable embeddings, isolated from the GPT generation gateway."""

import asyncio
import math
import threading
from functools import lru_cache

from app.agent_provider import ProviderError, post_json
from app.config import settings

_local_lock = threading.Lock()


class EmbeddingUnavailable(Exception):
    pass


def model_key() -> str:
    variant = f":{settings.rag_local_model_file}" if settings.rag_provider == "local" else ""
    return (
        f"{settings.rag_provider}:{settings.rag_embedding_model}:{settings.rag_dimensions}{variant}"
    )


def validate_vector(value, dimensions: int) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != dimensions:
        raise EmbeddingUnavailable("Invalid embedding dimensions")
    if any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
        for v in value
    ):
        raise EmbeddingUnavailable("Invalid embedding values")
    norm = math.sqrt(sum(v * v for v in value))
    if norm <= 0:
        raise EmbeddingUnavailable("Empty embedding vector")
    return [float(v / norm) for v in value]


@lru_cache(maxsize=1)
def _local_model(model_name: str, cache_dir: str, model_file: str, threads: int):
    from fastembed import TextEmbedding
    from fastembed.common.model_description import ModelSource, PoolingType

    if model_name != "intfloat/multilingual-e5-small":
        raise EmbeddingUnavailable("Unsupported local embedding model")
    alias = "secrethon-multilingual-e5-small"
    if not any(model["model"] == alias for model in TextEmbedding.list_supported_models()):
        TextEmbedding.add_custom_model(
            model=alias,
            pooling=PoolingType.MEAN,
            normalization=True,
            sources=ModelSource(hf=model_name),
            dim=384,
            model_file=model_file,
            description="Multilingual E5 small with mean pooling",
            license="MIT",
            size_in_gb=0.12,
        )
    return TextEmbedding(
        model_name=alias, cache_dir=cache_dir, threads=threads, providers=["CPUExecutionProvider"]
    )


def _local_embed(texts: list[str], query: bool) -> list[list[float]]:
    if settings.rag_dimensions != 384:
        raise EmbeddingUnavailable("Local E5 requires 384 dimensions")
    with _local_lock:
        model = _local_model(
            settings.rag_embedding_model,
            settings.rag_cache_dir,
            settings.rag_local_model_file,
            settings.rag_threads,
        )
        prefix = "query: " if query else "passage: "
        values = model.embed([prefix + value for value in texts], batch_size=8)
        return [validate_vector(value.tolist(), 384) for value in values]


async def embed(texts: list[str], *, query: bool = False) -> list[list[float]]:
    if not texts:
        return []
    if len(texts) > 32 or any(not value.strip() or len(value) > 8000 for value in texts):
        raise EmbeddingUnavailable("Embedding input exceeds limits")
    if settings.rag_provider == "local":
        try:
            return await asyncio.to_thread(_local_embed, texts, query)
        except EmbeddingUnavailable:
            raise
        except Exception as exc:
            # Model/network failures must not disclose download URLs or credentials.
            raise EmbeddingUnavailable("Local embedding model unavailable") from exc
    if not settings.embedding_api_key:
        raise EmbeddingUnavailable("EMBEDDING_API_KEY is not configured")
    try:
        result = await post_json(
            settings.embedding_base_url.rstrip("/") + "/embeddings",
            {
                "model": settings.rag_embedding_model,
                "input": texts,
                "dimensions": settings.rag_dimensions,
                "encoding_format": "float",
            },
            {"Authorization": "Bearer " + settings.embedding_api_key},
            "Embeddings",
        )
        rows = result.get("data", [])
        if len(rows) != len(texts) or {row.get("index") for row in rows} != set(range(len(texts))):
            raise EmbeddingUnavailable("Incomplete embedding response")
        return [
            validate_vector(row["embedding"], settings.rag_dimensions)
            for row in sorted(rows, key=lambda row: row["index"])
        ]
    except ProviderError as exc:
        raise EmbeddingUnavailable(f"Embeddings provider unavailable ({exc.status})") from None
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        raise EmbeddingUnavailable("Invalid embedding response") from exc
