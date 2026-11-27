"""Harbor providers for exported VFS-Bench tasks (install vfsbench[harbor])."""

from .export import export

__all__ = ["export", "MirageEnvironment", "MirageVerifier"]


# Harbor imports the provider class by name. Keep the base SDK and exporter
# usable in installations without Harbor.
def __getattr__(name: str):
    if name in {"MirageEnvironment", "MirageVerifier"}:
        from . import adapter

        return getattr(adapter, name)
    raise AttributeError(name)
