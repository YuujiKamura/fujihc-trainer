"""pytest fixtures for fujihill-trainer."""
import json
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
# SoT 統一済 (= web/static/course.json 1 本)。 fixture path を全 test で共有する単独定義点。
COURSE_JSON: Path = REPO_ROOT / "web" / "static" / "course.json"


def load_course() -> list[dict]:
    """course.json を読んで list[dict] で返す (= 各 test の Arrange 重複撤去用)。"""
    with COURSE_JSON.open(encoding="utf-8") as f:
        return json.load(f)


def pytest_collection_modifyitems(config, items):
    """asyncio test を実行可能に。pytest-asyncio が無くても scope を auto に。"""
    pass


@pytest.fixture
def anyio_backend():
    return "asyncio"
