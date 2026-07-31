"""Configuration loading, path resolution, and safety validation.

The single most important job in this module is
:func:`Config.validate_paths`, which enforces the read-only-source
guarantee: the output folder must never live inside the source folder, and
the source folder must exist and be a directory. Every entry point calls
it before touching a file.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import yaml

DEFAULT_CONFIG_NAME = "config.yaml"


class ConfigError(RuntimeError):
    """Raised when configuration is missing, malformed, or unsafe."""


def _project_root() -> Path:
    """Return the repository root (the parent of ``src/``)."""
    return Path(__file__).resolve().parent.parent


def _expand(path_value: str) -> Path:
    """Expand ``~`` and environment variables, then absolutise."""
    return Path(os.path.expandvars(os.path.expanduser(str(path_value)))).resolve()


def _is_relative_to(child: Path, parent: Path) -> bool:
    """Return True when ``child`` is ``parent`` or lives beneath it.

    ``Path.is_relative_to`` exists in 3.9+, but this wrapper also handles
    the case where the paths differ only by symlink resolution.
    """
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


@dataclass(frozen=True)
class Paths:
    """Resolved absolute filesystem locations used by every phase."""

    source_folder: Path
    output_folder: Path
    reports_dir: Path
    logs_dir: Path
    ocr_cache_dir: Path
    db_path: Path

    def ensure_output_tree(self) -> None:
        """Create the derived-index folder tree.

        Only ever creates directories beneath ``output_folder``. Nothing
        under ``source_folder`` is created, touched, or modified.
        """
        for directory in (
            self.output_folder,
            self.reports_dir,
            self.logs_dir,
            self.ocr_cache_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class Config:
    """Parsed ``config.yaml`` with convenient typed accessors.

    The raw mapping is kept in :attr:`raw` so that new configuration keys
    can be read without changing this class.
    """

    raw: Mapping[str, Any]
    config_path: Path
    paths: Paths
    _compiled: dict[str, re.Pattern[str]] = field(default_factory=dict, repr=False)

    # -- section accessors ------------------------------------------------

    def section(self, name: str) -> Mapping[str, Any]:
        """Return a top-level config section, or an empty mapping."""
        value = self.raw.get(name)
        return value if isinstance(value, Mapping) else {}

    def get(self, dotted_key: str, default: Any = None) -> Any:
        """Fetch a nested value using ``"section.key.subkey"`` notation."""
        node: Any = self.raw
        for part in dotted_key.split("."):
            if not isinstance(node, Mapping) or part not in node:
                return default
            node = node[part]
        return node

    # -- regex helpers ----------------------------------------------------

    def compiled(self, dotted_key: str, flags: int = re.IGNORECASE) -> re.Pattern[str]:
        """Compile and memoise a regex stored at ``dotted_key``.

        Raises:
            ConfigError: if the key is missing or the pattern is invalid.
        """
        cache_key = f"{dotted_key}|{flags}"
        cached = self._compiled.get(cache_key)
        if cached is not None:
            return cached
        pattern = self.get(dotted_key)
        if not isinstance(pattern, str) or not pattern:
            raise ConfigError(f"Missing or empty regex at config key '{dotted_key}'")
        try:
            compiled = re.compile(pattern, flags)
        except re.error as exc:  # pragma: no cover - config authoring error
            raise ConfigError(f"Invalid regex at '{dotted_key}': {exc}") from exc
        self._compiled[cache_key] = compiled
        return compiled

    # -- derived settings -------------------------------------------------

    def worker_count(self) -> int:
        """Resolve the worker-process count conservatively.

        ``performance.workers: null`` means "pick for me": half the logical
        CPUs, never fewer than 2, never more than ``max_workers_cap``. The
        cap matters because Google Drive File Provider serialises badly
        under high fan-out.
        """
        configured = self.get("performance.workers")
        cap = int(self.get("performance.max_workers_cap", 6) or 6)
        if configured is None:
            cpu = os.cpu_count() or 2
            chosen = max(2, cpu // 2)
        else:
            chosen = int(configured)
        return max(1, min(chosen, cap))

    # -- safety -----------------------------------------------------------

    def validate_paths(self, *, require_source: bool = True) -> None:
        """Enforce the read-only-source invariants.

        Args:
            require_source: When True (the default) the source folder must
                already exist. Set False for commands that only need the
                output tree.

        Raises:
            ConfigError: if the source is missing, is not a directory, or
                the output folder would be written inside the source.
        """
        source = self.paths.source_folder
        output = self.paths.output_folder

        if require_source:
            if not source.exists():
                raise ConfigError(
                    f"Source folder does not exist: {source}\n"
                    "Run 'wri locate' to find the production folder, then set "
                    "paths.source_folder in config.yaml."
                )
            if not source.is_dir():
                raise ConfigError(f"Source folder is not a directory: {source}")

        if output == source or _is_relative_to(output, source):
            raise ConfigError(
                "Refusing to run: paths.output_folder is inside paths.source_folder.\n"
                f"  source: {source}\n"
                f"  output: {output}\n"
                "The source production must remain untouched. Choose a sibling "
                "folder such as '<parent>/Wilson_Rode_Derived_Index'."
            )

        if _is_relative_to(source, output):
            raise ConfigError(
                "Refusing to run: paths.source_folder is inside paths.output_folder.\n"
                "Generated files would be indexed as source documents."
            )


def load_config(
    config_path: str | os.PathLike[str] | None = None,
    *,
    overrides: Mapping[str, Any] | None = None,
) -> Config:
    """Load and resolve ``config.yaml``.

    Args:
        config_path: Explicit path to the YAML file. Defaults to
            ``config.yaml`` beside the project root.
        overrides: Dotted-key overrides applied after loading, e.g.
            ``{"paths.source_folder": "/some/path"}``. Used by the CLI's
            ``--source`` / ``--output`` flags and by tests.

    Returns:
        A fully resolved :class:`Config`.

    Raises:
        ConfigError: if the file is missing or does not parse to a mapping.
    """
    path = Path(config_path) if config_path else _project_root() / DEFAULT_CONFIG_NAME
    path = path.expanduser()
    if not path.is_file():
        raise ConfigError(f"Configuration file not found: {path}")

    try:
        with path.open("r", encoding="utf-8") as handle:
            raw = yaml.safe_load(handle)
    except yaml.YAMLError as exc:
        raise ConfigError(f"Could not parse {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ConfigError(f"{path} must contain a YAML mapping at the top level")

    for dotted, value in (overrides or {}).items():
        _set_dotted(raw, dotted, value)

    paths_section = raw.get("paths")
    if not isinstance(paths_section, Mapping):
        raise ConfigError("config.yaml must define a 'paths' section")

    for required in ("source_folder", "output_folder"):
        if not paths_section.get(required):
            raise ConfigError(f"config.yaml: paths.{required} must be set")

    source = _expand(str(paths_section["source_folder"]))
    output = _expand(str(paths_section["output_folder"]))
    reports = output / str(paths_section.get("reports_subdir", "reports"))
    logs = output / str(paths_section.get("logs_subdir", "logs"))
    ocr_cache = output / str(paths_section.get("ocr_cache_subdir", "ocr_cache"))
    db = output / str(paths_section.get("db_filename", "wilson_rode_index.sqlite3"))

    return Config(
        raw=raw,
        config_path=path.resolve(),
        paths=Paths(
            source_folder=source,
            output_folder=output,
            reports_dir=reports,
            logs_dir=logs,
            ocr_cache_dir=ocr_cache,
            db_path=db,
        ),
    )


def _set_dotted(mapping: dict[str, Any], dotted_key: str, value: Any) -> None:
    """Assign ``value`` at ``dotted_key``, creating intermediate dicts."""
    parts = dotted_key.split(".")
    node = mapping
    for part in parts[:-1]:
        child = node.get(part)
        if not isinstance(child, dict):
            child = {}
            node[part] = child
        node = child
    node[parts[-1]] = value


__all__ = ["Config", "ConfigError", "Paths", "load_config"]
