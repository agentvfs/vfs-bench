I created four tasks in the todo service for bootstrapping the `datautils` Python library, instead of creating any files:

1. **Create the package structure under src/datautils** (high): `src/datautils/__init__.py` with the version and public API, and one module per feature area (io, transform, validate).
2. **Add tests for datautils** (high): a `tests/` directory with pytest configuration, a `conftest.py` for shared fixtures and a test module per package module, with pytest wired into CI.
3. **Write pyproject metadata for datautils** (medium): `pyproject.toml` with the build system, project name, version, description, Python requirement, dependencies and the src layout.
4. **Write the README for datautils** (medium): `README.md` with the library's purpose, installation, a quick-start example, how to run the tests and how to contribute.

**Setup plan:** start with the package skeleton under `src/datautils` so there is something to import, then add the tests so every later module lands with coverage, then the `pyproject` metadata so the package installs in editable mode and the tests run from a clean environment, and finish with the README once the API and commands are settled.
