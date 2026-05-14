"""pytest fixtures for fujihc-trainer."""
import pytest


def pytest_collection_modifyitems(config, items):
    """asyncio test を実行可能に。pytest-asyncio が無くても scope を auto に。"""
    pass


@pytest.fixture
def anyio_backend():
    return "asyncio"
