from app.schema import parse_index_mapping


def test_mapping_discovers_multiple_vector_kinds_and_nested_limitations():
    mapping = {
        "articles": {
            "mappings": {
                "properties": {
                    "title": {"type": "text"},
                    "title_vector": {
                        "type": "dense_vector",
                        "dims": 384,
                        "similarity": "cosine",
                    },
                    "body_vector": {
                        "type": "dense_vector",
                        "dims": 768,
                        "similarity": "dot_product",
                    },
                    "semantic_body": {
                        "type": "semantic_text",
                        "inference_id": "elser-endpoint",
                    },
                    "comments": {
                        "type": "nested",
                        "properties": {
                            "embedding": {"type": "dense_vector", "dims": 384}
                        },
                    },
                }
            }
        }
    }

    schema = parse_index_mapping("articles", mapping, model_dimension=384)
    fields = {field["name"]: field for field in schema["vector_fields"]}

    assert fields["title_vector"]["local_compatible"] is True
    assert fields["body_vector"]["local_compatible"] is False
    assert fields["semantic_body"]["inference_id"] == "elser-endpoint"
    assert fields["comments.embedding"]["compatible"] is False
    assert "Nested vector fields" in fields["comments.embedding"]["reason"]
