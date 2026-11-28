import json
import re
from pathlib import PurePosixPath

from mirage.errors.fs import eisdir, enoent
from mirage.types import ContentType, FileStat, FileType
from mirage.vfs.base import BaseVFS

ROOTS = ("products", "orders", "customers", "categories")
LISTING = re.compile(
    r"(?:products|orders|customers|categories|products/\d+/variations)")
OBJECT = re.compile(
    r"(?:products|orders|customers|categories|products/\d+/variations)/\d+")


class WooFiles(BaseVFS):
    name = "woocommerce"
    index_ttl = 0
    caches_reads = False

    def __init__(self, store):
        super().__init__(vfs_md="WooCommerce API objects as JSON. Use the "
                         "woocommerce CLI to "
                         "update the store.")
        self.store = store

    @staticmethod
    def _entry(name):
        if name.endswith(".json"):
            return FileStat(name=name,
                            type=FileType.FILE,
                            content=ContentType.JSON)
        return FileStat(name=name, type=FileType.DIRECTORY, size=0)

    @staticmethod
    def _endpoint(path):
        if path.split("/", 1)[0] == "categories":
            return "products/" + path
        return path

    async def readdir(self, path):
        name = (path.dir if path.pattern else path).vfs_path.strip("/")
        if not name:
            names = ROOTS
        elif re.fullmatch(r"products/\d+", name):
            await self.store.get(name)
            names = ["variations"]
        elif LISTING.fullmatch(name):
            rows = await self.store.listing(self._endpoint(name))
            names = []
            for row in rows:
                names.append(f"{row['id']}.json")
                if name == "products" and row["type"] == "variable":
                    names.append(str(row["id"]))
        else:
            raise enoent(path)
        return [self._entry(n) for n in names]

    async def read(self, path):
        name = path.vfs_path.strip("/")
        if not name.endswith(".json"):
            raise eisdir(path)
        route = name.removesuffix(".json")
        if not OBJECT.fullmatch(route):
            raise enoent(path)
        data, _ = await self.store.get(self._endpoint(route))
        return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode()

    async def stat(self, path):
        name = PurePosixPath(path.vfs_path).name or "/"
        if name.endswith(".json"):
            await self.read(path)
        else:
            await self.readdir(path)
        return self._entry(name)
