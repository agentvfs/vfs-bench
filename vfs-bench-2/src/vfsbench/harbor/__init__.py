"""Harbor providers for exported VFS-Bench tasks (install vfsbench[harbor])."""


# Harbor imports the provider class by name. Keep the base SDK and exporter
# usable in installations without Harbor.
def __getattr__(name: str):
    if name in {"MirageEnvironment", "MirageVerifier"}:
        from . import adapter

        return getattr(adapter, name)
    raise AttributeError(name)
