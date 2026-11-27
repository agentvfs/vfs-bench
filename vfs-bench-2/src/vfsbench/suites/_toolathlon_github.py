"""Serve the three v1 GitHub fixtures through Mirage's offline repository
model."""

import asyncio
import base64
import copy
import hashlib
import json
from contextlib import asynccontextmanager
from pathlib import PurePosixPath

from aiohttp import web

from .vendor.github import github

# Digest of the sorted {target: sha256} bindings from the published v1 release.
FIXTURE_HASHES = {
    'git-repo':
    '122314ce5b192da2c048445cc5f139aa0417d8a180ae1dd9af5f1b906ded3afe',
    'personal-website-construct':
    '181317e708ec9d11996ac91a6c2dd64ac7a53d671d422d8ba59b834801ba98cd',
    'sync-todo-to-readme':
    'abea463aa37634f89b432a8e428eac1be17baeaf69387b87c64c3e5496a69d9a',
}


def _seed(task):
    state = github.FakeGitHub()
    entries = [
        f for f in task.manifest['source_assets']
        if f['target'].startswith('shared/fixtures/')
    ]
    digests = {f['target']: f['sha256'] for f in entries}
    if hashlib.sha256(json.dumps(
            digests,
            sort_keys=True).encode()).hexdigest() != FIXTURE_HASHES[task.id]:
        raise ValueError(f'Unrecognized GitHub fixture tree: {task.id}')
    files = task.files(digests)
    state.create_repos = task.id == 'git-repo'
    if task.id == 'git-repo':
        github_path = files['shared/fixtures/repos.json']
        for full_name, meta in json.loads(github_path.read_bytes()).items():
            owner, name = full_name.split('/')
            state.repo(owner, name,
                       meta.get('default_branch') or 'main').meta.update(meta)
        return state
    if task.id == 'personal-website-construct':
        repo = state.repo('academicpages', 'academicpages.github.io', 'master')
    else:
        repo = state.repo('integ-user', 'LUFFY', 'main')
    for entry in entries:
        fixture = PurePosixPath(entry['target']).relative_to('shared/fixtures')
        branch = fixture.parts[0]
        if task.id == 'personal-website-construct':
            branch = 'master'
        path = PurePosixPath(*fixture.parts[1:]).as_posix()
        data = files[entry['target']].read_bytes()
        if path == 'SUBMODULES':
            for line in data.decode().splitlines():
                if line.strip():
                    repo.seed_submodule(line.strip())
        else:
            repo.trees_by_branch.setdefault(branch, {})
            repo.seed_path(path, data, branch)
    return state


@asynccontextmanager
async def serve(task):
    state = await asyncio.to_thread(_seed, task)
    handler = github.GitHubServer(state)
    app = web.Application()
    for prefix in ('', '/api/v3'):
        github._add_routes(app, handler, prefix)
    app.router.add_get('/raw/{owner}/{repo}/{ref}/{path:.*}',
                       handler.raw_content)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    try:
        await web.TCPSite(runner, '127.0.0.1', 0).start()
        state.base = 'http://127.0.0.1:' + str(runner.addresses[0][1])
        yield state
    finally:
        await runner.cleanup()


def workspace(task, state):
    common = {'token': 'fake-token', 'base_url': state.base}
    config = {
        'clis': {
            'gh': {
                'cli': 'gh',
                'machine': 'in_process',
                'config': common
            }
        },
        'network': {
            'allowed_domains': [state.base.removeprefix('http://')]
        },
        'mounts': {}
    }
    if task.id == 'git-repo':
        for name in ('pdfinfo', 'pdftotext'):
            config['clis'][name] = {'cli': name, 'machine': 'in_process'}
        instructions = (
            'Read the original paper in /workspace. Use gh api '
            'search/repositories to search the captured GitHub repositories.')
    elif task.id == 'personal-website-construct':
        config['mounts']['/template'] = {
            'vfs': 'github',
            'mode': 'read',
            'config': {
                **common, 'owner': 'academicpages',
                'repo': 'academicpages.github.io',
                'ref': 'master'
            }
        }
        instructions = (
            'The original personal memory is in '
            '/workspace/memory/memory.json. Read the source repository at '
            '/template, then use gh to fork and update it.')
    else:
        for branch in ('main', 'dev'):
            config['mounts']['/repo/' + branch] = {
                'vfs': 'github',
                'config': {
                    **common, 'owner': 'integ-user',
                    'repo': 'LUFFY',
                    'ref': branch
                }
            }
        instructions = (
            'The original branches are mounted at /repo/main and /repo/dev. '
            'Use the files or the gh CLI to inspect and update the '
            'repository.')
    return config, instructions


def snapshot(state, task_id):
    if task_id == 'personal-website-construct':
        name, branch, paths = 'integ-user/LJT-Homepage', 'master', (
            '_config.yml', '_config.yaml', '_pages/about.md')
    else:
        name, branch, paths = 'integ-user/LUFFY', 'dev', ('README.md', )
    repo = state.repos.get(name)
    tree = repo.trees_by_branch.get(branch, {}) if repo else {}
    return {
        'owner': state.login,
        'repo': name,
        'branch': branch,
        'files': {
            path: tree[path].decode('utf8', errors='replace')
            for path in paths if path in tree
        }
    }


def state(store, task_id):
    repos = {}
    for name, repo in store.repos.items():
        repos[name] = {
            'meta': copy.deepcopy(repo.meta),
            'default_branch': repo.default_branch,
            'branches': {
                branch: {
                    path: base64.b64encode(data).decode()
                    for path, data in tree.items()
                }
                for branch, tree in repo.trees_by_branch.items()
            }
        }
    result = {'repositories': repos, 'owner': store.login}
    if task_id != 'git-repo':
        result['submission'] = snapshot(store, task_id)
    return result
