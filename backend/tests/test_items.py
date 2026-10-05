from fastapi.testclient import TestClient


def test_create_and_list_items(client: TestClient) -> None:
    created = client.post("/api/items", json={"title": "first"})
    assert created.status_code == 201
    item = created.json()
    assert item["title"] == "first"

    listed = client.get("/api/items")
    assert listed.status_code == 200
    assert item in listed.json()


def test_create_item_validates_title(client: TestClient) -> None:
    response = client.post("/api/items", json={"title": ""})
    assert response.status_code == 422
