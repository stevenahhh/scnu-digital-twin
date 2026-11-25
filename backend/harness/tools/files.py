from __future__ import annotations

import os
import re
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from collections.abc import Iterator
from typing import TextIO

from harness.config import EVAL_TOOL_CAP


class InvalidPath(ValueError):
    """The requested path leaves the allowed roots or traverses a symlink."""


class InvalidPage(ValueError):
    """Offsets and limits must be positive integers."""


class FileTools:
    def __init__(self, work_dir: Path, ref_dir: Path) -> None:
        self.roots = {"spill": Path(work_dir) / "spill", "out": Path(work_dir) / "out", "ref": Path(ref_dir)}

    def _resolve(self, path: str) -> tuple[Path, tuple[str, ...]]:
        parts = PurePosixPath(path).parts
        if not parts or parts[0] not in self.roots or ".." in parts or "\\" in path or "\0" in path:
            raise InvalidPath(path)
        root = self.roots[parts[0]]
        current = root
        for part in ("", *parts[1:]):
            current = current / part
            if current.is_symlink():
                raise InvalidPath(path)
        if not current.resolve().is_relative_to(root.resolve()):
            raise InvalidPath(path)
        return root, parts[1:]

    @contextmanager
    def _open(self, path: str) -> Iterator[TextIO]:
        root, parts = self._resolve(path)
        if not parts:
            raise InvalidPath(path)
        # Directory descriptors keep a concurrent kernel rename from escaping the jail.
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in parts[:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = child
            file_descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
        finally:
            os.close(descriptor)
        with os.fdopen(file_descriptor, encoding="utf-8", errors="replace") as stream:
            yield stream

    def read(self, path: str, offset: int = 1, limit: int = 200) -> str:
        if offset < 1 or limit < 1:
            raise InvalidPage(offset, limit)
        chunks: list[str] = []
        remaining = EVAL_TOOL_CAP
        with self._open(path) as stream:
            for _ in range(offset - 1):
                if not stream.readline():
                    return ""
            for _ in range(min(limit, 200)):
                line = stream.readline(remaining)
                if not line:
                    break
                chunks.append(line)
                remaining -= len(line)
                if remaining == 0:
                    break
        return "".join(chunks)

    def search(self, pattern: str, path: str | None = None, limit: int = 50) -> str:
        if limit < 1:
            raise InvalidPage(limit)
        regex = re.compile(pattern)
        matches: list[str] = []
        for requested in ([path] if path is not None else sorted(self.roots)):
            root, parts = self._resolve(requested)
            target = root.joinpath(*parts)
            candidates = sorted(target.rglob("*")) if target.is_dir() else [target]
            for candidate in candidates:
                relative = f"{PurePosixPath(requested).parts[0]}/{candidate.relative_to(root).as_posix()}"
                self._resolve(relative)
                if not candidate.is_file():
                    continue
                with self._open(relative) as stream:
                    for number, line in enumerate(stream, 1):
                        if regex.search(line):
                            matches.append(f"{relative}:{number}:{line.rstrip(chr(10)).rstrip(chr(13))}")
                            if len(matches) >= min(limit, 50):
                                return "\n".join(matches)
        return "\n".join(matches)
