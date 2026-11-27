"""Read release catalogs and fetch individual task files on demand."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import urllib.request
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Self, overload

if TYPE_CHECKING:
    from .runtime import EnvironmentFactory, Trial, TrialConfig
    from .verifier import Verifier


def _checkout(start: Path) -> Path | None:
    for parent in (start, *start.parents):
        if (parent / "vfsbench/dataset.py").is_file() and (
                parent / "datasets").is_dir():
            return parent
    return None


def _relative(value: str) -> str:
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute(
    ) or ".." in path.parts or "\\" in value or ":" in value:
        raise ValueError(f"Invalid release-relative path: {value!r}")
    return str(path)


def _digest(asset: dict) -> str:
    digest = asset["sha256"]
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}",
                                                       digest):
        raise ValueError(f"Invalid SHA-256: {digest!r}")
    if type(asset["size"]) is not int or asset["size"] < 0:
        raise ValueError(f"Invalid byte length for {digest}")
    return digest


def _matches(path: Path, digest: str, size: int) -> bool:
    if not path.is_file() or path.stat().st_size != size:
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == digest


@dataclass(frozen=True)
class Task:
    """A catalog entry. Reading the manifest or a referenced prompt fetches
    just that file."""

    id: str
    upstream_id: str
    _row: dict = field(repr=False)
    _dataset: Dataset = field(repr=False)

    def open(self,
             *,
             config: TrialConfig | None = None,
             verifier: Verifier | None = None,
             environment: EnvironmentFactory | None = None) -> Trial:
        """Create an attempt. Entering its async context starts the services
        and workspace."""
        from .runtime import Trial

        return Trial(self,
                     config=config,
                     verifier=verifier,
                     environment=environment)

    @property
    def instruction(self) -> str:
        value = self._row["instruction"]
        if value is None:
            return self._dataset._source_file(
                self._row["instruction_source"]).read_bytes().decode()
        return value

    @property
    def manifest(self) -> dict:
        manifest = json.loads(
            self._dataset._file(self._row["manifest"]).read_bytes())
        if manifest.get("schema_version") != 1 or manifest.get(
                "id") != self.id:
            raise ValueError(f"Incompatible manifest for task {self.id!r}")
        if self._dataset.suite is not None and manifest.get(
                "dataset") != self._dataset.suite:
            raise ValueError(
                f"Expected a {self._dataset.suite} manifest for {self.id!r}")
        return manifest

    def _bundled(self, asset: dict) -> Path:
        digest = _digest(asset)
        if asset["path"] != f"assets/sha256/{digest}":
            raise ValueError(
                f"Invalid asset binding for {self.id}/{asset['target']}")
        path = self._dataset._file(asset["path"])
        if not _matches(path, digest, asset["size"]):
            raise ValueError(
                f"Asset integrity mismatch for {self.id}/{asset['target']}: "
                f"{digest}")
        return path

    @cached_property
    def _bindings(self):
        manifest = self.manifest
        bindings = {}
        for resolve, assets in ((self._bundled, manifest["assets"]),
                                (self._dataset._source_file,
                                 manifest.get("source_assets", []))):
            for asset in assets:
                name = _relative(asset["target"])
                if name in bindings:
                    raise ValueError(
                        f"Duplicate asset binding for {self.id}/{name}")
                bindings[name] = (resolve, asset)
        return bindings

    def file(self, target: str) -> Path:
        """Resolve a single bundled or source-backed target, indexing the
        manifest once."""
        resolve, asset = self._bindings[_relative(target)]
        return resolve(asset)

    def files(self, targets: Iterable[str]) -> dict[str, Path]:
        """Resolve selected targets without fetching any other task files."""
        return {name: self.file(name) for name in targets}

    def materialize(self, *, include_sources: bool = False) -> dict[str, Path]:
        """Map task-relative names to verified read-only cache paths.

        By default, read only files carried by the release. Set
        `include_sources` to resolve the files listed in `source_assets` too.
        The manifest also describes dependencies such as images and services.
        """
        manifest = self.manifest
        files = {}
        for asset in manifest["assets"]:
            target = _relative(asset["target"])
            if target in files:
                raise ValueError(
                    f"Duplicate asset binding for {self.id}/{target}")
            files[target] = self._bundled(asset)
        if include_sources:
            for asset in manifest.get("source_assets", []):
                target = _relative(asset["target"])
                if target in files:
                    raise ValueError(
                        f"Duplicate asset binding for {self.id}/{target}")
                files[target] = self._dataset._source_file(asset)
        return files


class Dataset(Sequence[Task]):
    """An indexed local release directory or a single immutable revision on
    the Hub."""

    suite: str | None = None

    def __init__(
        self,
        root: str | Path | None = None,
        *,
        cache_dir: str | Path | None = None,
        local_files_only: bool = False,
    ):
        if root is None:
            checkout = _checkout(Path.cwd()) or _checkout(
                Path(__file__).resolve())
            if self.suite is None or checkout is None:
                raise ValueError("Pass a local release directory or use "
                                 "Dataset.from_hub(repo_id)")
            root = checkout / "datasets" / self.suite
        self.root = Path(root).expanduser().resolve()
        self.repo_id: str | None = None
        self.revision: str | None = None
        self._cache_dir = cache_dir
        self._local_files_only = local_files_only
        self._tasks: list[Task] = []
        self._by_id: dict[str, Task] = {}
        with (self.root / "index.jsonl").open(encoding="utf-8") as stream:
            for line in stream:
                row = json.loads(line)
                task_id = row["id"]
                if task_id in self._by_id:
                    raise ValueError(
                        f"Duplicate task ID in index.jsonl: {task_id!r}")
                _relative(row["manifest"])
                task = Task(task_id, row["upstream_id"], row, self)
                self._tasks.append(task)
                self._by_id[task_id] = task

    @classmethod
    def from_hub(
        cls,
        repo_id: str,
        *,
        revision: str = "main",
        cache_dir: str | Path | None = None,
        local_files_only: bool = False,
    ) -> Self:
        """Download only the catalog and pin later reads to its full Hub
        commit SHA."""
        from huggingface_hub import hf_hub_download

        index = Path(
            hf_hub_download(repo_id,
                            "index.jsonl",
                            repo_type="dataset",
                            revision=revision,
                            cache_dir=cache_dir,
                            local_files_only=local_files_only))
        # The Hub returns <cache>/<repo>/snapshots/<commit>/index.jsonl even
        # for a tag.
        # Resolving this symlink would yield a content blob and lose the
        # revision.
        commit = index.parent.name
        if not re.fullmatch(r"[0-9a-f]{40}",
                            commit) or index.parent.parent.name != "snapshots":
            raise ValueError(f"Missing Hub snapshot revision for {index}")
        dataset = cls(index.parent,
                      cache_dir=cache_dir,
                      local_files_only=local_files_only)
        dataset.repo_id = repo_id
        dataset.revision = commit
        return dataset

    def __len__(self) -> int:
        return len(self._tasks)

    @property
    def local_files_only(self) -> bool:
        """Whether dependency reads use only local files and caches."""
        return self._local_files_only

    def __iter__(self) -> Iterator[Task]:
        return iter(self._tasks)

    @overload
    def __getitem__(self, key: int | str) -> Task:
        ...

    @overload
    def __getitem__(self, key: slice) -> list[Task]:
        ...

    def __getitem__(self, key: int | str | slice) -> Task | list[Task]:
        return self._by_id[key] if isinstance(key, str) else self._tasks[key]

    def _file(self, filename: str) -> Path:
        filename = _relative(filename)
        if self.repo_id is not None:
            from huggingface_hub import hf_hub_download

            return Path(
                hf_hub_download(self.repo_id,
                                filename,
                                repo_type="dataset",
                                revision=self.revision,
                                cache_dir=self._cache_dir,
                                local_files_only=self._local_files_only))
        path = (self.root / filename).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f"File is outside the release: {filename}")
        return path

    def _source_file(self, asset: dict) -> Path:
        digest = _digest(asset)
        size = asset["size"]
        relative = _relative(asset["path"]) if asset.get("path") else None
        url = asset["url"]
        label = relative or url
        checkout = _checkout(self.root) or _checkout(Path(__file__).resolve())
        if checkout is not None and relative is not None:
            path = (checkout / relative).resolve()
            if path.is_relative_to(checkout) and _matches(path, digest, size):
                return path
        cache = self._cache_dir or os.environ.get(
            "XDG_CACHE_HOME") or Path.home() / ".cache"
        destination = Path(cache).expanduser() / "vfsbench/sources" / digest
        if _matches(destination, digest, size):
            return destination
        if self._local_files_only:
            raise FileNotFoundError(
                f"Source unavailable offline: {label} ({digest})")
        if not url.startswith("https://"):
            raise ValueError(f"Expected an HTTPS source URL for {label}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent,
                                         delete=False) as temp:
            staging = Path(temp.name)
        try:
            with urllib.request.urlopen(
                    url, timeout=60) as remote, staging.open("wb") as output:
                remaining = size
                while chunk := remote.read(min(1 << 20, remaining + 1)):
                    remaining -= len(chunk)
                    if remaining < 0:
                        raise ValueError(
                            f"Source exceeds declared size: {label}")
                    output.write(chunk)
            if not _matches(staging, digest, size):
                raise ValueError(
                    f"Source integrity mismatch for {label}: {digest}")
            staging.replace(destination)
            return destination
        finally:
            staging.unlink(missing_ok=True)


class Toolathlon(Dataset):
    """The VFS-Bench Toolathlon suite."""

    suite = "toolathlon"


class MCPAtlas(Dataset):
    """The VFS-Bench MCP-Atlas suite."""

    suite = "mcpatlas"


def load_dataset(release: str | Path | Dataset,
                 *,
                 revision: str | None = None,
                 local_files_only: bool = False) -> Dataset:
    """Open a checkout suite name, a release directory, or a Hub dataset ID."""
    if isinstance(release, Dataset):
        if revision or (local_files_only and not release.local_files_only):
            raise ValueError(
                "Set revision and cache policy when opening the dataset")
        return release
    if Path(release).expanduser().is_dir() or isinstance(release, Path):
        if revision:
            raise ValueError("A revision applies only to a Hub dataset ID")
        return Dataset(release, local_files_only=local_files_only)
    named = {"toolathlon": Toolathlon, "mcpatlas": MCPAtlas}
    if release in named:
        if revision:
            raise ValueError("Supply a Hub dataset ID to select a revision")
        return named[release](local_files_only=local_files_only)
    return Dataset.from_hub(release,
                            revision=revision or "main",
                            local_files_only=local_files_only)
