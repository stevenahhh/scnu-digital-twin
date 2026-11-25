from pathlib import Path

import pytest

from harness.sessions import SessionStore
from harness.tools.files import FileTools, InvalidPath
from harness.tools.todo import todo


@pytest.fixture
def files(tmp_path: Path) -> FileTools:
    work, ref = tmp_path / "work", tmp_path / "ref"
    for path in (work / "spill", work / "out", ref):
        path.mkdir(parents=True)
    (work / "spill/lines.txt").write_text("".join(f"line {i}\n" for i in range(1, 301)))
    (work / "out/result.txt").write_text("match result\n")
    (ref / "elements.tsv").write_text("BLD_D4\tEngineering\n")
    return FileTools(work, ref)


def test_read_pages_lines_and_reference_corpus(files: FileTools) -> None:
    assert files.read("spill/lines.txt", offset=200, limit=2) == "line 200\nline 201\n"
    assert len(files.read("spill/lines.txt", limit=1000).splitlines()) == 200
    assert files.read("spill/lines.txt", offset=301) == ""
    assert files.read("ref/elements.tsv") == "BLD_D4\tEngineering\n"


def test_read_enforces_character_cap(files: FileTools, tmp_path: Path) -> None:
    (tmp_path / "work/out/long.txt").write_text("가" * 9000)
    assert files.read("out/long.txt") == "가" * 6000


@pytest.mark.parametrize("path", [
    "../meta.json", "out/../spill/lines.txt", "/etc/passwd",
    "tmp/file", "journal.jsonl", "ref/../../secret", "out\\..\\secret",
])
def test_file_tools_reject_unsafe_paths(files: FileTools, path: str) -> None:
    with pytest.raises(InvalidPath):
        files.read(path)
    with pytest.raises(InvalidPath):
        files.search(".", path=path)


@pytest.mark.parametrize("directory", [False, True])
def test_file_tools_reject_symlinks(files: FileTools, tmp_path: Path, directory: bool) -> None:
    target = tmp_path / "ref"
    link = tmp_path / "work/out/link"
    link.symlink_to(target if directory else target / "elements.tsv", target_is_directory=directory)
    path = "out/link/elements.tsv" if directory else "out/link"
    with pytest.raises(InvalidPath):
        files.read(path)
    with pytest.raises(InvalidPath):
        files.search(".", path=path)
    with pytest.raises(InvalidPath):
        files.search(".", path="out")


def test_search_regex_line_numbers_roots_and_limit(files: FileTools) -> None:
    assert files.search(r"line (2|3)$", path="spill", limit=1) == "spill/lines.txt:2:line 2"
    assert files.search("BLD_D4|match") == "out/result.txt:1:match result\nref/elements.tsv:1:BLD_D4\tEngineering"
    assert len(files.search("line", limit=100).splitlines()) == 50


def test_todo_replaces_checklist_and_restores_from_journal(tmp_path: Path) -> None:
    store = SessionStore(tmp_path)
    session = store.create("acct:a", "admin")
    todo(session, [{"text": "Old", "done": False}])
    items = [{"text": "Current", "done": False}, {"text": "Finished", "done": True}]
    result = todo(session, items)
    items[0]["text"] = "Mutated by caller"
    assert result == {"items": [{"text": "Current", "done": False}, {"text": "Finished", "done": True}]}
    restored = SessionStore(tmp_path).get("acct:a", session.conversation_id)
    assert restored.todo == result["items"]
    with pytest.raises(ValueError):
        todo(session, [{"text": str(i), "done": False} for i in range(9)])
    assert todo(session, []) == {"items": []}
