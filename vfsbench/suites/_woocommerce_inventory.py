import asyncio
import json
import shutil
from contextlib import AsyncExitStack

from ..runtime import VerifierGuest
from ..snapshot import IMAGE
from ._woocommerce_store import VENDOR, docker

WP_CLI = {
    "url": "https://raw.githubusercontent.com/wp-cli/builds/"
    "05989a431e982caf17cd94508ff9b4c5fb12ae44/phar/wp-cli.phar",
    "sha256":
    "ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c",
    "size": 7142777
}
CITIES = ("boston", "dallas", "houston", "los_angeles", "new_york",
          "san_francisco")


def _stage(task, root):
    (root / "preprocess").mkdir(parents=True)
    (root / "wheels").mkdir()
    for source in task.manifest["source_assets"]:
        if source["target"].startswith("upstream/preprocess/"):
            target = root / source["target"].removeprefix("upstream/")
            shutil.copyfile(task._dataset._source_file(source), target)
    wheels = json.loads((VENDOR / "seeder-wheels.json").read_bytes())
    for name, desc in wheels.items():
        shutil.copyfile(task._dataset._source_file(desc),
                        root / "wheels" / name)
    shutil.copyfile(VENDOR / "inventory-seed.py", root / "driver.py")


async def create_site(task, store, sql_cli, hashed, *, title, email):
    phar = await asyncio.to_thread(task._dataset._source_file, WP_CLI)
    await docker("cp", str(phar), store.wordpress + ":/tmp/wp.phar")
    url = "http://localhost:10003"

    async def wp(*args, initial=False):
        env = ("-e", "VFSBENCH_WP_INSTALL=1") if initial else ()
        return await docker("exec", *env, store.wordpress, "php",
                            "/tmp/wp.phar", "--allow-root",
                            "--path=/var/www/html", *args)

    await wp("core",
             "install",
             "--url=" + url,
             "--title=My WooCommerce Store",
             "--admin_user=mcpwoocommerce",
             "--admin_email=woocommerce@mcp.com",
             "--admin_password=" + store.secret,
             "--skip-email",
             initial=True)
    await wp("plugin", "activate", "woocommerce", initial=True)
    await wp("rewrite", "structure", "/%postname%/", initial=True)
    await wp("core",
             "multisite-convert",
             "--title=My Multisite Network",
             "--skip-config",
             initial=True)
    await wp("plugin", "activate", "woocommerce", "--network")
    await wp("site", "create", "--slug=" + store.site, "--title=" + title,
             "--email=" + email)
    # WooCommerce creates the subsite tables on the first request after network
    # activation.
    await wp("eval", "WC_Install::install();",
             "--url=" + url + "/" + store.site)
    await docker("cp", str(VENDOR / "multisite.htaccess"),
                 store.wordpress + ":/var/www/html/.htaccess")
    await docker(
        *sql_cli,
        stdin=("INSERT INTO wp_2_woocommerce_api_keys "
               "(user_id,description,permissions,consumer_key,consumer_secret,"
               "truncated_key)"
               f" VALUES (1,'Inventory initializer','read_write','{hashed}',"
               f"'{store.secret}','{store.key[-7:]}');").encode())


async def initialize(task, run_dir, store, sql_cli, hashed):
    await create_site(task,
                      store,
                      sql_cli,
                      hashed,
                      title="Emma Myers's Store",
                      email="emma_myers@mcp.com")
    stage = run_dir / "inventory-seed"
    await asyncio.to_thread(_stage, task, stage)
    container = store.name + "-seed"
    offline = task._dataset._local_files_only
    pull = "--pull=never" if offline else "--pull=missing"
    async with AsyncExitStack() as scope:
        scope.push_async_callback(docker,
                                  "rm",
                                  "--force",
                                  container,
                                  missing_ok=True)
        await docker("run", "--detach", pull, "--network", store.name,
                     "--name", container, IMAGE, "sleep", "infinity")
        await docker("cp", str(stage), container + ":/seed")
        code, output = await docker("exec",
                                    "-e",
                                    "WOO_KEY=" + store.key,
                                    "-e",
                                    "WOO_SECRET=" + store.secret,
                                    container,
                                    "python3",
                                    "-I",
                                    "/seed/driver.py",
                                    check=False)
        if code:
            raise RuntimeError("Upstream inventory initialization failed: " +
                               output.decode(errors="replace")[-1800:])
        await docker("cp", container + ":/seed/woocommerce_config.json",
                     str(stage / "config.json"))
        mapping = json.loads(
            (stage / "config.json").read_bytes())["product_mapping"]
        if set(mapping) != {"East", "South", "West"} or any(
                len(rows) != 17 for rows in mapping.values()):
            raise ValueError(
                "Upstream initializer did not create all 51 regional products")
        (run_dir / "inventory-mapping.json").write_text(json.dumps(mapping))
        warehouse = run_dir / "workspace/warehouse"
        warehouse.mkdir(parents=True)
        for city in CITIES:
            file = f"warehouse_{city}.db"
            await docker("cp", container + ":/seed/work/warehouse/" + file,
                         str(warehouse / file))
    shutil.rmtree(stage)


async def verify(view, task, config, run_dir):
    files = {
        "driver.py": (VENDOR / "inventory-grader.py").read_bytes(),
        "products.json":
        json.dumps((await
                    view.service_state("woocommerce"))["products"]).encode(),
        "mapping.json": (run_dir / "inventory-mapping.json").read_bytes()
    }
    for desc in task.manifest["source_assets"]:
        if desc["target"].startswith("upstream/evaluation/"):
            path = await asyncio.to_thread(task._dataset._source_file, desc)
            files[
                "code/" +
                desc["target"].removeprefix("upstream/")] = path.read_bytes()
    for city in CITIES:
        name = f"warehouse/warehouse_{city}.db"
        if await view.is_file("/workspace/" + name):
            files["agent/" + name] = await view.read_file("/workspace/" + name)
    async with VerifierGuest(config) as guest:
        outcome = await guest.run(files, ["python3", "-I", "driver.py"])
    if outcome.return_code not in (0, 10):
        raise RuntimeError("Inventory verifier failed: " +
                           (outcome.stdout + outcome.stderr)[-1800:])
    return {
        "reward": int(outcome.return_code == 0),
        "grader": "toolathlon/evaluation/main.py"
    }
