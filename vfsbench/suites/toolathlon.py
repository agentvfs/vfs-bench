"""Build isolated trials for supported Toolathlon release tasks.

File tasks mount the original workspace and run Python in the trial's private
microVM. GitHub, Google Workspace, HowToCook and W&B use fresh service fixtures
for each run.
The separate verifier microVM reads selected outputs and frozen service state,
then executes the hash-pinned upstream evaluator. Its SDK shims replay the
same service reads without giving the verifier network access.

Google Cloud tasks require a local Docker engine and V1's digest-pinned
BigQuery image. This covers flagged-transactions, price-comparison,
game-statistics, machine-operating, ab-testing, academic-warning and
live-transactions.
Machine-operating, ab-testing and live-transactions also use V1's pinned
fake-gcs-server image. Both containers share a trial-private loopback. Offline
execution requires those images to be cached first. Cloud Logging uses the
bundled V1 store in a trial-private directory for ab-testing, academic-warning
and live-transactions. Game-statistics runs the original date-dependent fixture
generator in a separate offline microVM before opening its workspace.
WooCommerce-new-welcome combines BigQuery with a trial-private WooCommerce
installation and the Mirage mail server to grade CRM updates and sent messages.

Use `vfsbench status <release-dir>` for the installed adapters and their
requirements. All release rows remain available through the dataset API.
Additional tasks require their own platform fixtures, live-source replacements,
workspace preprocessing or verifier integrations.
"""

import asyncio
import csv
import hashlib
import io
import json
import os
import stat
import tarfile
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path, PurePosixPath

from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from . import _toolathlon_bigquery as bigquery
from . import _toolathlon_calendar as calendar_tasks
from . import _toolathlon_documents as documents
from . import _toolathlon_github as github
from . import _toolathlon_gws as gws
from . import _toolathlon_logging as cloud_logging
from . import _toolathlon_notion as notion
from . import _toolathlon_services as services

HERE = Path(__file__).parent
# These reviewed paths and hashes are part of the installed controller. A Hub
# repository cannot replace the evaluator, invent an agent mount or select
# code.
INPUTS = json.loads(
    (HERE / 'toolathlon_inputs.json').read_text(encoding='utf8'))
INPUTS.update(services.INPUTS)
OUTPUTS = {
    **services.OUTPUTS,
    'detect-revised-terms': 'revised_terms.csv',
    'excel-data-transformation': 'Processed.xlsx',
    'excel-market-research': 'segment_growth_rates.xlsx',
    'flagged-transactions': 'anomaly_audit_report.xlsx',
    'imagenet': 'survey.tex',
    'git-repo': 'result.json',
    'reimbursement-form-filler': 'department_expenses.xlsx',
    'sales-accounting': 'Account_Book.xlsx',
}
NHL = 'nhl-b2b-analysis'
COOKING = {'cooking-guidance', 'dietary-health'}
WOOCOMMERCE = {
    'woocommerce-update-cover', 'inventory-sync', 'update-material-inventory'
}
SUPPORTED = frozenset(INPUTS) | COOKING | documents.MANIFESTS.keys(
) | notion.MANIFESTS.keys() | calendar_tasks.MANIFESTS.keys() | WOOCOMMERCE | {
    "apply-phd-email", "course-assistant", "course-schedule",
    "woocommerce-new-welcome"
}
OUTPUT_TREES = {
    'arrange-workspace': '',
    'privacy-desensitization': 'desensitized_documents',
    'paper-checker': 'my_paper',
    'courses-ta-hws': 'os_hw3',
}


def _archive_members(task_id, data):
    """Implement the pinned archive-only preprocessors over reviewed,
    hash-checked bytes."""
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for member in tar:
            relative = PurePosixPath(member.name)
            if relative.is_absolute() or '..' in relative.parts or not (
                    member.isdir() or member.isfile()):
                raise ValueError(
                    f'Unexpected file in Toolathlon archive: {member.name!r}')
            if task_id in {'arrange-workspace', 'privacy-desensitization'}:
                prefixes = {
                    'arrange-workspace': 'initial_workspace_arrange',
                    'privacy-desensitization': 'files'
                }
                relative = relative.relative_to(prefixes[task_id])
            if task_id == 'privacy-desensitization' and any(
                    name in {'.DS_Store', '__MACOSX'} or name.startswith('._')
                    for name in relative.parts):
                continue
            if (task_id == 'reimbursement-form-filler'
                    and relative.suffix != '.pdf'):
                continue
            if relative.parts:
                yield relative, None if member.isdir() else tar.extractfile(
                    member).read()


def _read(task, name):
    path = task.file(name)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != INPUTS[task.id][name]:
        raise ValueError(
            f'Toolathlon source differs from the reviewed release: '
            f'{task.id}/{name}')
    return data


def _stage_workspace(task, root):
    root.mkdir(exist_ok=True)
    for name in INPUTS[task.id]:
        if name.startswith('upstream/initial_workspace/'):
            dest = root / name.removeprefix('upstream/initial_workspace/')
            dest.parent.mkdir(parents=True, exist_ok=True)
            data = _read(task, name)
            if name.endswith('.tar.gz'):
                for path, content in _archive_members(task.id, data):
                    target = dest.parent / path
                    if content is None:
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(content)
            else:
                dest.write_bytes(data)


def _verifier_files(task, final_answer):
    pure_python = {
        *OUTPUT_TREES, *cloud_logging.TASKS, 'game-statistics', 'imagenet',
        'price-comparison'
    }
    staged = {
        'driver.py': (HERE / '_toolathlon_grader.py').read_bytes(),
        'trajectory.json':
        json.dumps({
            'final_answer': final_answer
        }).encode(),
        'code/evaluation/__init__.py':
        b'',
        'requirements.json':
        json.dumps([] if task.id in
                   pure_python else ['pandas', 'openpyxl']).encode()
    }
    for name in INPUTS[task.id]:
        if name.startswith('upstream/evaluation/'):
            staged['code/evaluation/' +
                   name.removeprefix('upstream/evaluation/')] = _read(
                       task, name)
        elif name.startswith('upstream/groundtruth_workspace/') and (
                name
                != 'upstream/groundtruth_workspace/Billboard Pop Chart by '
                'Year.xlsx'):
            target = name.removeprefix('upstream/groundtruth_workspace/')
            # The pricing grader locates its CSV relative to its own source.
            directory = 'truth/'
            if task.id == 'price-comparison':
                directory = 'code/groundtruth_workspace/'
            staged[directory + target] = _read(task, name)
    if task.id == 'personal-website-construct':
        # The original grader imports PyYAML. Mirage already installs it on the
        # controller; its pure-Python loader can run on any guest architecture.
        import yaml
        for module_path in Path(yaml.__file__).parent.glob('*.py'):
            staged['code/yaml/' + module_path.name] = module_path.read_bytes()
    if task.id == 'courses-ta-hws':
        # The original grader compares submission hashes to the unmodified
        # inputs.
        for path, contents in _archive_members(
                task.id, _read(task,
                               'upstream/initial_workspace/files.tar.gz')):
            if contents is not None:
                staged['initial_workspace/' + str(path)] = contents
    return staged


def _local_setup(task, run_dir):
    _stage_workspace(task, run_dir / 'workspace')
    clis = []
    if task.id in {
            'detect-revised-terms', 'imagenet', 'reimbursement-form-filler',
            'arrange-workspace'
    }:
        clis.extend(('pdftotext', 'pdfinfo'))
    if task.id in {
            'excel-data-transformation', 'excel-market-research',
            'sales-accounting', 'arrange-workspace', 'courses-ta-hws',
            'reimbursement-form-filler'
    }:
        clis.append('office')
    tools = ', '.join(clis)
    instructions = (
        'The original task files are in /workspace. Use Python or the '
        'shell to complete the task '
        'in that directory.' +
        (f' The configured document commands are {tools}.' if tools else ''))
    return {
        'clis': {
            name: {
                'cli': name,
                'machine': 'in_process'
            }
            for name in clis
        }
    }, instructions


def _freeze_output_tree(root, task_id, files):
    """Read the live disk mount, including guest writes outside Mirage's
    directory cache."""
    target = root / OUTPUT_TREES[task_id]
    directories = []
    if target.exists() and not target.is_symlink():
        for dirname, children, names, directory in os.fwalk(
                target, follow_symlinks=False):
            relative = Path(dirname).relative_to(root)
            directories.append(relative.as_posix())
            for child in children:
                if not stat.S_ISDIR(
                        os.stat(child, dir_fd=directory,
                                follow_symlinks=False).st_mode):
                    raise ValueError(
                        f'Unsupported directory entry: {relative / child}')
            for name in names:
                flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                with os.fdopen(os.open(name, flags, dir_fd=directory),
                               'rb') as stream:
                    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                        raise ValueError(
                            f'Unsupported file entry: {relative / name}')
                    # The arrange-workspace grader compares only names and
                    # types.
                    files['agent/' + (relative / name).as_posix()] = (
                        b''
                        if task_id == 'arrange-workspace' else stream.read())
    files['directories.json'] = json.dumps(directories).encode()


@asynccontextmanager
async def prepare(task, config, run_dir: Path):
    if task.id in notion.MANIFESTS:
        async with notion.prepare(task, config, run_dir) as prepared:
            yield prepared
        return
    if task.id == 'woocommerce-new-welcome':
        from . import _toolathlon_welcome
        async with _toolathlon_welcome.prepare(task, config,
                                               run_dir) as prepared:
            yield prepared
        return
    if task.id == 'apply-phd-email':
        from . import _toolathlon_phd
        async with _toolathlon_phd.prepare(task, config, run_dir) as prepared:
            yield prepared
        return
    if task.id == 'course-schedule':
        from . import _toolathlon_schedule
        async with _toolathlon_schedule.prepare(task, config,
                                                run_dir) as prepared:
            yield prepared
        return
    if task.id == 'course-assistant':
        from . import _toolathlon_course
        async with _toolathlon_course.prepare(task, config,
                                              run_dir) as environment:
            yield environment
        return
    if task.id in calendar_tasks.MANIFESTS:
        async with calendar_tasks.prepare(task, config,
                                          run_dir) as environment:
            yield environment
        return
    if task.id in documents.MANIFESTS:
        async with documents.prepare(task, config, run_dir) as environment:
            yield environment
        return
    if task.id in WOOCOMMERCE:
        if task.id == 'update-material-inventory':
            from ._woocommerce_material import prepare as prepare_woo
        else:
            from ._toolathlon_woocommerce import prepare as prepare_woo
        async with prepare_woo(task, config, run_dir) as prepared:
            yield prepared
        return
    if task.id in COOKING:
        from ._toolathlon_cooking import prepare_howtocook
        async with prepare_howtocook(task, config, run_dir) as prepared:
            yield prepared
        return
    if task.id not in SUPPORTED:
        raise NotImplementedError(
            f'Toolathlon task {task.id!r} has no verified execution adapter. '
            f'Available tasks: {", ".join(sorted(SUPPORTED))}')
    async with AsyncExitStack() as stack:
        state_readers = {}
        install = None
        if task.id in services.INPUTS:
            setup = await services.workspace(task, config, run_dir, stack)
            workspace_config, instructions, state_readers = setup
        elif task.id in bigquery.TASKS:
            await asyncio.to_thread(_stage_workspace, task,
                                    run_dir / 'workspace')
            provider = await stack.enter_async_context(
                bigquery.serve(task, run_dir, config))
            install = provider.install
            state_readers['bigquery'] = provider.state
            if task.id in {
                    'ab-testing', 'live-transactions', 'machine-operating'
            }:
                from . import _toolathlon_gcs as gcs
                provider.storage = await stack.enter_async_context(
                    gcs.serve(task, provider))
                state_readers['storage'] = provider.storage.state
            if task.id in cloud_logging.TASKS:
                provider.logging = await asyncio.to_thread(
                    cloud_logging.Logging, task, run_dir / 'cloud-logging')
                state_readers['logging'] = provider.logging.state
            tools = {
                'flagged-transactions': ['office'],
                'machine-operating': ['office'],
                'price-comparison': ['pdftotext', 'pdfinfo']
            }.get(task.id, [])
            workspace_config = {
                'clis': {
                    name: {
                        'cli': name,
                        'machine': 'in_process'
                    }
                    for name in tools
                }
            }
            instructions = (
                'Query the private BigQuery emulator using google-cloud '
                'bigquery-list-datasets and '
                'google-cloud bigquery-run-query, passing one JSON object '
                'with a query field. '
                'SQL supports table creation and inserts. Each result '
                'previews the first five rows. '
                'The original task files are in /workspace.')
            if provider.storage is not None:
                instructions += (
                    ' Use google-cloud storage-list-buckets to find the '
                    'bucket and '
                    'google-cloud storage-upload-file to upload your report '
                    'from /workspace.')
            if provider.logging is not None:
                instructions += (
                    ' Discover the tables via google-cloud '
                    'bigquery-get-dataset-info. '
                    'Use google-cloud logging-list-logs for the log names '
                    'and logging-write-log '
                    'with log_name, severity and a text message.')
        elif task.id in github.FIXTURE_HASHES:
            await asyncio.to_thread(_stage_workspace, task,
                                    run_dir / 'workspace')
            git_state = await stack.enter_async_context(github.serve(task))
            workspace_config, instructions = github.workspace(task, git_state)

            async def github_state():
                return github.state(git_state, task.id)

            state_readers['github'] = github_state
        elif task.id == NHL:
            base = await stack.enter_async_context(
                gws.serve(run_dir,
                          config.suite_options.get('mirage_checkout')))
            schedule = await asyncio.to_thread(_read, task, 'shared/nhl.csv')
            rows = list(csv.reader(schedule.decode().splitlines()))
            folder = await asyncio.to_thread(gws.seed, base,
                                             'NHL-B2B-Analysis',
                                             'NHL 2425 Schedule', rows)

            async def gws_state():
                return await asyncio.to_thread(gws.state, base)

            state_readers['gws'] = gws_state
            endpoint = await stack.enter_async_context(gws.agent_api(base))
            credentials = {
                'access_token': 'gws-integ-token',
                'api_base': endpoint
            }
            mount = {'vfs': 'gdrive', 'mode': 'read', 'config': credentials}
            workspace_config = {
                'mounts': {
                    '/gd': mount
                },
                'clis': {
                    'gws': {
                        'cli': 'gws',
                        'machine': 'in_process',
                        'config': credentials
                    }
                },
                'network': {
                    'allowed_domains': [endpoint.removeprefix('http://')]
                },
            }
            instructions = (
                f'Read the schedule through /gd/NHL-B2B-Analysis or the gws '
                f'CLI. '
                f'Create the result spreadsheet inside Drive folder {folder}. '
                'Use `gws drive files create --help` and `gws sheets write '
                '--help` for syntax.')
        else:
            workspace_config, instructions = await asyncio.to_thread(
                _local_setup, task, run_dir)

        async def evaluate(view):
            files = await asyncio.to_thread(
                _verifier_files, task,
                view.result.final_answer if view.result else '')
            if task.id == NHL:
                title = 'NHL-B2B-Analysis'
                rows = gws.result_rows(await view.service_state('gws'), folder,
                                       title)
                files['sheet.json'] = json.dumps({
                    'title': title,
                    'folder': folder,
                    'rows': rows
                }).encode()
                files['code/files/folder_id.txt'] = folder.encode()
            elif task.id in {
                    'personal-website-construct', 'sync-todo-to-readme'
            }:
                files['github.json'] = json.dumps(
                    (await
                     view.service_state('github'))['submission']).encode()
            elif task.id in {'game-statistics', 'price-comparison'}:
                files['bigquery.json'] = json.dumps(
                    await view.service_state('bigquery')).encode()
            elif task.id in {'machine-operating', *cloud_logging.TASKS}:
                if 'storage' in state_readers:
                    files['storage.json'] = json.dumps(
                        await view.service_state('storage')).encode()
                files['configs/gcp-service_account.keys.json'] = json.dumps({
                    'project_id':
                    bigquery.PROJECT
                }).encode()
                if task.id in cloud_logging.TASKS:
                    files.update(await cloud_logging.freeze(view))
                    files['code/groundtruth_workspace/log_bucket_'
                          'name.txt'] = files['truth/log_bucket_name.txt']
                if task.id == 'academic-warning':
                    scores = await asyncio.to_thread(
                        _read, task, 'upstream/files/scores_2501.csv')
                    files['code/files/scores_2501.csv'] = scores
                output = {
                    'academic-warning': 'bad_student.csv',
                    'ab-testing': 'record.csv'
                }.get(task.id)
                if output and await view.is_file('/workspace/' + output):
                    files['agent/' +
                          output] = await view.read_file('/workspace/' +
                                                         output)
            elif task.id == 'flagged-transactions':
                # The upstream grader falls back to other .xlsx submissions.
                for entry in await view.list_dir('/workspace'):
                    name = PurePosixPath(entry).name
                    if name.endswith('.xlsx') and await view.is_file(
                            '/workspace/' + name):
                        files['agent/' +
                              name] = await view.read_file('/workspace/' +
                                                           name)
            elif task.id in OUTPUT_TREES:
                await asyncio.to_thread(_freeze_output_tree,
                                        run_dir / 'workspace', task.id, files)
            else:
                name = OUTPUTS[task.id]
                if await view.is_file('/workspace/' + name):
                    files['agent/' +
                          name] = await view.read_file('/workspace/' + name)
            async with VerifierGuest(config) as guest:
                result = await guest.run(files, ['python3', '-I', 'driver.py'])
            if result.return_code not in {0, 10}:
                raise RuntimeError(f'Toolathlon verifier failed for {task.id} '
                                   f'({result.return_code}): '
                                   f'{result.stderr[-1000:]}')
            return {
                'reward': float(result.return_code == 0),
                'grader': 'toolathlon/evaluation/main.py'
            }

        yield TrialEnvironment(workspace=workspace_config,
                               verifier=SuiteVerifier(evaluate),
                               instructions=instructions,
                               state_readers=state_readers,
                               install=install)
