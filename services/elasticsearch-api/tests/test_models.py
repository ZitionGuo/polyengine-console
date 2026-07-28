import pytest
from pydantic import ValidationError

from app.models import SearchRequest


def request_data(**overrides):
    data = {
        "index": "articles",
        "text": "vector databases",
        "vector_targets": [{"field": "embedding"}],
    }
    data.update(overrides)
    return data


def test_single_mode_requires_one_vector_target():
    with pytest.raises(ValidationError, match="exactly one"):
        SearchRequest.model_validate(
            request_data(
                vector_targets=[
                    {"field": "title_embedding"},
                    {"field": "body_embedding"},
                ]
            )
        )


def test_duplicate_vector_fields_are_rejected():
    with pytest.raises(ValidationError, match="selected only once"):
        SearchRequest.model_validate(
            request_data(
                result_mode="fuse",
                vector_targets=[
                    {"field": "embedding"},
                    {"field": "embedding"},
                ],
            )
        )


def test_hybrid_mode_requires_lexical_fields():
    with pytest.raises(ValidationError, match="lexical field"):
        SearchRequest.model_validate(request_data(mode="hybrid"))
