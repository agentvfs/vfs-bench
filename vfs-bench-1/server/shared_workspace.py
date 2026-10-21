"""Shared files for a local Mirage workspace and native E2B commands.

The harness owns the S3 prefix, mount process and credentials. Database
volumes and process state stay on the sandbox's local filesystem.
"""
import gzip
import io
import json
import os
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import time
import uuid
from contextlib import ExitStack, contextmanager
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MIRAGE = REPO / 'submodule/mirage'
REMOTE = '/root/toolathlon-workspace'
CURRENT = None
# What a browser task's shell runs natively in its sandbox. Upstream's
# terminal checks every command's first word against its ALLOWED_COMMANDS,
# which names these but not node, npm, npx, bash or sh.
BROWSER_CAPTURES = ('git', 'curl', 'wget')


def active():
    """The remote workspace owned by this runner, if it has one."""
    return CURRENT


class RemoteWorkspace:
    """Native commands and original servers share one sandbox filesystem."""

    def __init__(self, box, config, workdir, directory, ssh_config):
        self.box, self.config = box, config
        self.workdir = Path(workdir)
        self.directory = directory
        self.ssh_config = ssh_config
        # The master holds the -L forwards the host reaches the sandbox
        # through. A listening forward does not keep it open, so a timed
        # persist closes it once no command has run for that long, and the
        # next command opens a master without them. It lives until the run's
        # `-O exit`.
        self.ssh = [
            'ssh', '-F', '/dev/null', '-T', '-i', ssh_config['identityFile'],
            '-p',
            str(ssh_config['port']), '-o', 'BatchMode=yes', '-o',
            'StrictHostKeyChecking=yes', '-o',
            'UserKnownHostsFile=' + ssh_config['knownHosts'], '-o',
            'ControlMaster=auto', '-o', 'ControlPersist=yes', '-o',
            'ControlPath=' + str(directory / 'control'), 'user@127.0.0.1'
        ]
        self.env = {
            'PATH': '/opt/agent-python/.venv/bin:/usr/local/bin:/usr/bin:/bin',
            'UV_PROJECT': '/opt/agent-python',
            'UV_NO_SYNC': '1',
            'UV_CACHE_DIR': '/home/user/.cache/toolathlon-uv',
            'KUBECONFIG': '/home/user/.kube/config',
            'KUBECONFIG_PATH': '/home/user/.kube/config'
        }
        self.captures = ['python', 'python3']
        self.browser_record = None
        self.shared_disk = False
        self.env.update(HTTP_PROXY='http://127.0.0.1:9',
                        HTTPS_PROXY='http://127.0.0.1:9',
                        http_proxy='http://127.0.0.1:9',
                        https_proxy='http://127.0.0.1:9',
                        NO_PROXY='localhost,127.0.0.1,::1',
                        no_proxy='localhost,127.0.0.1,::1')

    def launch(self, command, env=None):
        return {
            'command': self.ssh[0],
            'args': [*self.ssh[1:], 'cd /work && ' + self.line(command, env)],
            'cwd': str(self.workdir)
        }

    def line(self, command, env=None):
        """One command in the sandbox's environment, run where it is cd'd."""
        return 'exec env ' + shlex.join([
            f'{key}={value}' for key, value in {
                **self.env,
                **(env or {})
            }.items()
        ]) + ' ' + shlex.join(command)

    def workspace(self, body):
        root = body.get('profiles', {}).get('default', {}).get('cwd', '/work')
        if root == '/workspace':
            # Keep the declared Python sandbox (or its absence). Native
            # terminal commands still run beside the original cluster.
            captures = [
                name for name in self.captures
                if name not in ('python', 'python3')
            ]
            if captures:
                body['runtimes'].insert(0, runtime_spec(self.box, captures))
        else:
            body['runtimes'] = [
                runtime_spec(self.box, self.captures), 'workspace'
            ]
        body['env'] = {**body.get('env', {}), **self.env}
        body['mounts'][root] = ({
            'vfs': 'ssh',
            'config': {
                **self.ssh_config, 'root': '/work'
            }
        } if self.shared_disk else {
            **mount_spec(self.config), 'read': 'fresh'
        })
        body['mounts']['/tmp'] = {
            'vfs': 'ssh',
            'config': {
                **self.ssh_config, 'root': '/tmp'
            }
        }
        body['mounts'].pop('/opt/wheels', None)
        if 'mysql' in body.get('clis', {}):
            install_mysql(self.box)
        return body

    async def python_tool(self, context, parameters):
        """Invoke the original Python tool in its locked environment."""
        from mirage.runtime.sandbox.e2b import E2BRuntime
        runtime = E2BRuntime(
            config={
                'sandbox_id': self.box.sandbox_id,
                'api_key': os.environ['E2B_API_KEY']
            })
        code = ('import asyncio,importlib.util,json,sys;'
                'from types import SimpleNamespace;'
                's=importlib.util.spec_from_file_location("original_python",'
                '"/opt/agent-python/python_interpretor.py");'
                'm=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                'p=json.load(sys.stdin);'
                'print(json.dumps(asyncio.run(m.on_python_execute_tool_invoke('
                'SimpleNamespace(context={"_agent_workspace":"/work"}),'
                'p))))')
        try:
            result = await runtime.run_line(
                shlex.join([
                    'timeout', '--signal=KILL', '135',
                    '/opt/agent-python/.venv/bin/python', '-c', code
                ]),
                json.dumps(parameters).encode(), self.env, '/work')
            if result.exit_code:
                raise RuntimeError(
                    result.stderr.decode(errors='replace')[-2000:])
            return json.loads(result.stdout)
        finally:
            await runtime.close()

    def save(self, name, data):
        self.box.files.write('/work/' + name, data, user='user')

    def collect(self):
        """Retain this run's S3 artifacts beside its local transcript."""
        import boto3
        cfg = self.config
        client = boto3.client(
            's3',
            region_name=cfg.get('region'),
            **{
                name: cfg[name]
                for name in ('aws_access_key_id', 'aws_secret_access_key',
                             'aws_session_token', 'endpoint_url')
                if name in cfg
            })
        if self.shared_disk:
            # Grading has finished. Preserve POSIX artifacts (including Git
            # metadata) as one archive, without making S3 implement a Git fs.
            run(self.box, 'pkill -KILL -u user || true')
            run(self.box,
                'tar -czf /root/toolathlon-artifacts.tar.gz -C /work .')
            data = self.box.files.read('/root/toolathlon-artifacts.tar.gz',
                                       format='bytes',
                                       user='root')
            with tempfile.TemporaryDirectory(
                    prefix='toolathlon-artifacts-') as directory:
                with tarfile.open(fileobj=io.BytesIO(data),
                                  mode='r:gz') as archive:
                    archive.extractall(directory, filter='data')
                for path in self.workdir.iterdir():
                    if path.is_dir() and not path.is_symlink():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
                for path in Path(directory).iterdir():
                    shutil.move(str(path), self.workdir / path.name)
            key = cfg['key_prefix'].removesuffix('/work') + '/workspace.tar.gz'
            client.put_object(Bucket=cfg['bucket'], Key=key, Body=data)
            return
        prefix = cfg['key_prefix'] + '/'
        collected = set()
        for page in client.get_paginator('list_objects_v2').paginate(
                Bucket=cfg['bucket'], Prefix=prefix):
            for item in page.get('Contents', []):
                name = item['Key'].removeprefix(prefix)
                if not name or name.endswith('/'):
                    continue
                path = self.workdir / name
                if '..' in Path(name).parts or not path.resolve(
                ).is_relative_to(self.workdir.resolve()):
                    raise ValueError('S3 artifact escapes the run workspace')
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(
                    client.get_object(Bucket=cfg['bucket'],
                                      Key=item['Key'])['Body'].read())
                collected.add(path)
        # Reflect deletions too: retaining seeded templates would make the
        # recorded workspace differ from what the remote grader saw.
        for path in self.workdir.rglob('*'):
            if (path.is_file() or path.is_symlink()) and path not in collected:
                path.unlink()

    def grade(self, task, launch_time, timeout):
        """Run the original grader after uploading its private sources."""
        from server.seed.kubernetes import UPSTREAM, original
        prefix = f'tasks/finalpool/{task}'
        from server.seed.kubernetes import original_paths
        paths = [prefix + '/evaluation', 'utils']
        if original_paths(prefix + '/groundtruth_workspace'):
            paths.append(prefix + '/groundtruth_workspace')
        archive = subprocess.check_output(
            ['git', '-C',
             str(UPSTREAM), 'archive', 'HEAD', *paths])
        self.box.files.write('/opt/toolathlon/grading.tar.gz',
                             gzip.compress(archive, mtime=0),
                             user='root')
        run(
            self.box, 'tar -xzf /opt/toolathlon/grading.tar.gz '
            '-C /opt/toolathlon && rm /opt/toolathlon/grading.tar.gz')
        for target, source in (('token_key_session.py',
                                'token_key_session_example.py'),
                               ('global_configs.py',
                                'global_configs_example.py')):
            self.box.files.write('/opt/toolathlon/configs/' + target,
                                 original('configs/' + source),
                                 user='root')
        self.box.files.write('/opt/toolathlon/res_log.json', '{}', user='root')
        line = (
            'cd /opt/toolathlon && env UV_PROJECT=/opt/agent-python '
            'UV_NO_SYNC=1 '
            'PATH=/opt/agent-python/.venv/bin:/usr/local/bin:/usr/bin:/bin '
            'uv run -m ' + prefix.replace('/', '.') + '.evaluation.main ' +
            shlex.join([
                '--agent_workspace', '/work', '--res_log_file',
                '/opt/toolathlon/res_log.json', '--groundtruth_workspace',
                '/opt/toolathlon/' + prefix + '/groundtruth_workspace',
                '--launch_time', launch_time or ''
            ]))
        from e2b import CommandExitException
        try:
            result = self.box.commands.run(line,
                                           user='root',
                                           timeout=timeout,
                                           envs={
                                               'HOME': '/root',
                                               'UV_CACHE_DIR':
                                               '/root/.cache/uv'
                                           })
        except CommandExitException as error:
            result = error
        print(result.stdout, end='', flush=True)
        print(result.stderr, end='', flush=True)
        return result.exit_code


@contextmanager
def remote_workspace(box,
                     config,
                     workdir,
                     remote_config,
                     assets,
                     *,
                     browser=False,
                     shared_disk=False):
    """Use native E2B for Python and SSH for original MCP stdio."""
    import yaml

    from server.sandbox import Tunnel
    from server.seed.kubernetes import original
    global CURRENT
    previous = CURRENT
    with ExitStack() as exits:
        directory = Path(
            exits.enter_context(
                tempfile.TemporaryDirectory(prefix='toolathlon-remote-',
                                            dir='/tmp')))
        # The original dependencies, without task sources or answers.
        for name in ('pyproject.toml', 'uv.lock', 'README.md'):
            box.files.write('/opt/agent-python/' + name,
                            original(name),
                            user='root')
        box.files.write('/opt/agent-python/python_interpretor.py',
                        original('utils/aux_tools/python_interpretor.py'),
                        user='root')
        run(box, 'UV_PYTHON_INSTALL_DIR=/opt/python '
            'uv sync --frozen --project /opt/agent-python',
            timeout=600)
        # E2B's login shell can replace PATH. Use launchers so ordinary
        # python/python3 still enter the original environment in that case.
        box.files.write(
            '/opt/agent-python/python',
            '#!/bin/sh\nexec /opt/agent-python/.venv/bin/python "$@"\n',
            user='root')
        run(
            box, 'chmod 755 /opt/agent-python/python && '
            'ln -sfn /opt/agent-python/python /usr/local/bin/python && '
            'ln -sfn /opt/agent-python/python /usr/local/bin/python3')
        run(box, 'node --version && npm --version')
        if remote_config:
            for name in ('package.json', 'package-lock.json'):
                box.files.write('/opt/k8s-mcp/' + name,
                                (REPO / 'vendor/kubernetes-mcp' /
                                 name).read_bytes(),
                                user='root')
            run(box,
                'cd /opt/k8s-mcp && npm ci --no-audit --no-fund',
                timeout=300)
        from server.mcp.setup_filesystem import HOME as filesystem
        from server.mcp.setup_filesystem import verify_source
        verify_source()
        for name in ('package.json', 'package-lock.json'):
            box.files.write('/opt/filesystem/' + name,
                            (filesystem / name).read_bytes(),
                            user='root')
        run(box, 'cd /opt/filesystem && npm ci --ignore-scripts --omit=dev '
            '--no-audit --no-fund',
            timeout=180)
        box.files.write('/opt/excel-redirect/sitecustomize.py',
                        (REPO /
                         'redirect/excel/sitecustomize.py').read_bytes(),
                        user='root')
        run(
            box, 'install -d -m 755 /run/sshd && '
            'install -d -o user -g user -m 700 /home/user/.kube '
            '/home/user/.ssh /home/user/.cache '
            '/home/user/.cache/toolathlon-uv && '
            'mkdir -p /opt/toolathlon && chmod 700 /opt/toolathlon')
        if remote_config:
            run(
                box, 'cp ' + shlex.quote(remote_config) +
                ' /home/user/.kube/config && '
                'chown user:user /home/user/.kube/config && '
                'chmod 600 /home/user/.kube/config && rm -rf /work/k8s_configs'
            )
        if browser:
            from server.seed.browser import install
            install(box)
        run(box, 'chmod u-s /usr/bin/sudo')
        identity = directory / 'identity'
        subprocess.run([
            'ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f',
            str(identity)
        ],
                       check=True)
        identity.chmod(0o600)
        box.files.write('/home/user/.ssh/authorized_keys',
                        identity.with_suffix('.pub').read_bytes(),
                        user='user')
        run(box, 'chmod 600 /home/user/.ssh/authorized_keys && ssh-keygen -A')
        box.commands.run(
            '/usr/sbin/sshd -D -e -p 2222 -o ListenAddress=127.0.0.1 '
            '-o PasswordAuthentication=no -o PermitRootLogin=no',
            user='root',
            background=True,
            timeout=0)
        websocket = assets['websocat']
        run(
            box, 'curl -fsSL ' + shlex.quote(websocket['url']) +
            ' -o /tmp/websocat && '
            'printf %s ' +
            shlex.quote(websocket['sha256'] + '  /tmp/websocat\n') +
            ' | sha256sum -c - && chmod 755 /tmp/websocat')
        box.commands.run(
            '/tmp/websocat -b --exit-on-eof '
            'ws-l:0.0.0.0:8081 tcp:127.0.0.1:2222',
            user='root',
            background=True,
            timeout=0)
        tunnel = Tunnel(f'wss://{box.get_host(8081)}')
        exits.callback(tunnel.close)
        known_hosts = directory / 'known_hosts'
        public = box.files.read('/etc/ssh/ssh_host_ed25519_key.pub',
                                user='root').strip()
        known_hosts.write_text(f'[127.0.0.1]:{tunnel.port} {public}\n')
        remote = RemoteWorkspace(
            box, config, workdir, directory, {
                'host': '127.0.0.1',
                'port': tunnel.port,
                'username': 'user',
                'identityFile': str(identity),
                'knownHosts': str(known_hosts)
            })
        remote.shared_disk = shared_disk
        for attempt in range(20):
            connected = subprocess.run(
                [*remote.ssh, '-o', 'ConnectTimeout=5', 'true'],
                capture_output=True)
            if connected.returncode == 0:
                break
            if attempt == 19:
                raise RuntimeError(connected.stderr.decode(errors='replace'))
            time.sleep(.2)
        exits.callback(subprocess.run,
                       [*remote.ssh[:-1], '-O', 'exit', remote.ssh[-1]],
                       capture_output=True)
        keys = ('KUBECONFIG', 'KUBECTL', 'KUBECTL_NATIVE', 'K8S_PROCESS_DIR')
        old = {key: os.environ.get(key) for key in keys}

        def restore_env():
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        exits.callback(restore_env)
        if remote_config:
            # API mounts use the remote Kubernetes API tunnel.
            kube = yaml.safe_load(
                box.files.read('/home/user/.kube/config', user='user'))
            from urllib.parse import urlparse
            api_port = urlparse(kube['clusters'][0]['cluster']['server']).port
            import socket
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                local_port = sock.getsockname()[1]
            subprocess.run([
                *remote.ssh[:-1], '-O', 'forward', '-L',
                f'127.0.0.1:{local_port}:127.0.0.1:{api_port}', remote.ssh[-1]
            ],
                           check=True,
                           capture_output=True)
            kube['clusters'][0]['cluster'][
                'server'] = f'https://127.0.0.1:{local_port}'
            client_config = directory / 'kubeconfig'
            client_config.write_text(yaml.safe_dump(kube))
            client_config.chmod(0o600)
            os.environ.update(KUBECONFIG=str(client_config),
                              KUBECTL='/usr/local/bin/kubectl',
                              KUBECTL_NATIVE='/usr/local/bin/kubectl',
                              K8S_PROCESS_DIR=str(directory))
        else:
            remote.env.pop('KUBECONFIG')
            remote.env.pop('KUBECONFIG_PATH')
        run(box, 'ln -sfn /work /workspace')
        if browser:
            from server.seed.browser import connect
            for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy',
                        'https_proxy'):
                remote.env.pop(key, None)
            remote.captures += BROWSER_CAPTURES
            exits.enter_context(connect(remote, virtual_root='/workspace'))
        CURRENT = remote
        try:
            yield remote
        finally:
            # The sandbox is owned by this run. Kill residual native commands
            # after grading, including port-forwards whose SSH parent exited.
            # Otherwise an inherited /work cwd keeps FUSE busy at unmount.
            try:
                run(box, 'pkill -KILL -u user || true')
            finally:
                CURRENT = previous


def s3_config(task, run_id=None):
    """Use a new run prefix; never mount the bucket root or a prior run."""
    bucket = os.environ.get('BENCH_S3_BUCKET', '').strip()
    prefix = os.environ.get('BENCH_S3_PREFIX', '').strip('/')
    if not bucket or not prefix:
        raise ValueError(
            'Set BENCH_S3_BUCKET and BENCH_S3_PREFIX for shared files')
    for name in (task, run_id):
        if name is not None and (not name or '/' in name
                                 or name in ('.', '..')):
            raise ValueError('Task and run IDs must be single path components')
    config = {
        'bucket':
        bucket,
        'region':
        os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION'),
        'key_prefix':
        f'{prefix}/{task}/{run_id or uuid.uuid4().hex}/work',
    }
    for key, variable in (
        ('aws_access_key_id', 'AWS_ACCESS_KEY_ID'),
        ('aws_secret_access_key', 'AWS_SECRET_ACCESS_KEY'),
        ('aws_session_token', 'AWS_SESSION_TOKEN'),
        ('endpoint_url', 'AWS_ENDPOINT_URL_S3'),
    ):
        if value := os.environ.get(variable):
            config[key] = value
    if config.get('endpoint_url'):
        config['path_style'] = True
    return {key: value for key, value in config.items() if value is not None}


def mount_spec(config):
    """The same Mirage resource configuration works in Python and Node."""
    return {'vfs': 's3', 'config': dict(config)}


def runtime_spec(box, captures):
    """Route the declared native commands through the E2B SDK."""
    return {
        'name': 'e2b',
        'captures': list(captures),
        'config': {
            'sandboxId': box.sandbox_id,
            'apiKey': os.environ['E2B_API_KEY'],
        },
    }


def install_mysql(box):
    """Oracle's MySQL client, at the task pod's 8.4.11, for Debian 12.

    It runs beside the model's port-forward, as the pod's own client does
    behind the MCP arm's `exec_in_pod`. Only a workspace that declares the
    command installs it: upstream's task image has no `mysql` for the MCP
    arm's Python to find.
    """
    assets = json.loads((REPO / 'server/kubernetes-binaries.json').read_text())
    names = ('mysql-community-client-plugins', 'mysql-community-client-core')
    run(
        box, 'cd "$(mktemp -d -p /root)" && ' +
        ' && '.join(f'curl -fsSL {shlex.quote(assets[name]["url"])} '
                    f'-o {name}.deb' for name in names) + ' && printf %s ' +
        shlex.quote(''.join(f'{assets[name]["sha256"]}  {name}.deb\n'
                            for name in names)) +
        ' | sha256sum -c - && dpkg -i ' +
        ' '.join(f'{name}.deb' for name in names) + ' && rm -rf "$PWD"')


MATURIN = 'ghcr.io/pyo3/maturin:v1.9.6'


def mirage_wheel():
    """mirage-ai for the sandbox, built from the pinned source.

    mirage-ai carries its Rust streams as `mirage._rs`, so a wheel is per
    platform and upstream publishes none for a commit. It is built as
    upstream's CI builds it (`.github/workflows/build_wheels.yml`): maturin's
    manylinux container in `python/`, abi3, `--release --locked`, for E2B's
    x86_64. One wheel per pinned commit, kept under state/.

    Returns:
        Path: the wheel.
    """
    commit = subprocess.check_output(
        ['git', '-C', str(MIRAGE), 'rev-parse', 'HEAD'], text=True).strip()
    out = REPO / 'state/mirage-wheel' / commit
    wheels = sorted(out.glob('*.whl'))
    if wheels:
        return wheels[0]
    with tempfile.TemporaryDirectory(prefix='mirage-wheel-') as scratch:
        source = subprocess.check_output(
            ['git', '-C',
             str(MIRAGE), 'archive', 'HEAD', 'python', 'rust'])
        tarfile.open(fileobj=io.BytesIO(source)).extractall(scratch,
                                                            filter='data')
        subprocess.run([
            'docker', 'run', '--rm', '--platform', 'linux/amd64', '-v',
            f'{scratch}:/io', '-w', '/io/python', MATURIN, 'build',
            '--release', '--locked', '--out', '/io/dist'
        ],
                       check=True)
        built = sorted(Path(scratch, 'dist').glob('*.whl'))
        out.mkdir(parents=True, exist_ok=True)
        shutil.copy(built[0], out)
    return out / built[0].name


def requirements_bundle():
    """The pinned Mirage package's frozen dependency closure, hashed."""
    for name in ('pyproject.toml', 'uv.lock'):
        pinned = subprocess.check_output(
            ['git', '-C',
             str(MIRAGE), 'show', f'HEAD:python/{name}'])
        if (MIRAGE / 'python' / name).read_bytes() != pinned:
            raise RuntimeError(f'Mirage {name} differs from the pinned source')
    return subprocess.check_output([
        'uv', 'export', '--frozen', '--no-dev', '--extra', 's3', '--extra',
        'fuse', '--no-emit-project', '--format', 'requirements-txt'
    ],
                                   cwd=MIRAGE / 'python')


def run(box, command, timeout=180):
    from e2b import CommandExitException

    try:
        result = box.commands.run(command,
                                  user='root',
                                  timeout=timeout,
                                  envs={
                                      'HOME': '/root',
                                      'UV_CACHE_DIR': '/root/.cache/uv'
                                  })
    except CommandExitException as error:
        raise RuntimeError(
            f'Shared workspace setup failed ({error.exit_code})') from None
    if result.exit_code:
        # Setup output can include endpoint configuration. Keep secrets out
        # of exceptions, which the benchmark logs alongside model output.
        raise RuntimeError(
            f'Shared workspace setup failed ({result.exit_code})')
    return result


@contextmanager
def mounted(box, config):
    """Expose S3 as /work in an E2B sandbox, owned by this context.

    The image must contain uv, Python, fuse3 and mfusepy's system library.
    Call after privileged fixture setup and before dropping agent privileges.
    No task, MCP schema, prompt or grader is replaced by this mount.
    """
    from mirage.vfs.s3 import S3Config

    S3Config(**config)  # Validate before making any remote changes.
    run(
        box, f'install -d -m 700 {REMOTE} && mkdir -p /work && '
        '! mountpoint -q /work && test -z "$(ls -A /work)" && '
        'test -c /dev/fuse')
    wheel = mirage_wheel()
    for name, content in (
        ('requirements.txt', requirements_bundle()),
        (wheel.name, wheel.read_bytes()),
        ('config.json', json.dumps(config)),
        ('mount.py', Path(__file__).read_text()),
    ):
        box.files.write(f'{REMOTE}/{name}', content, user='root')
    run(box, f'cd {REMOTE} && uv venv --python 3.12 env && '
        'uv pip install --python env/bin/python --require-hashes '
        '-r requirements.txt && '
        'uv pip install --python env/bin/python --no-deps '
        f'./{wheel.name}',
        timeout=300)
    # allow_other exposes files to native commands without exposing the root
    # mount daemon's S3 credentials. The embedding harness removes sudo and
    # keeps setup/grader sources outside the agent's allowed filesystem.
    config_path = shlex.quote(REMOTE + '/config.json')
    handle = box.commands.run(
        f'cd {REMOTE} && env/bin/python mount.py {config_path}',
        user='root',
        background=True,
        timeout=0)
    ready = False
    try:
        for _ in range(30):
            result = box.commands.run(
                'if mountpoint -q /work; then '
                'printf ready; fi',
                user='root',
                timeout=10)
            if result.stdout == 'ready':
                ready = True
                break
            time.sleep(.2)
        else:
            raise RuntimeError('Shared S3 workspace did not mount')
        yield mount_spec(config)
    finally:
        try:
            if ready:
                run(box, 'fusermount3 -u /work', timeout=30)
        finally:
            handle.kill()


def mount_main(config_path):
    """Root-owned FUSE process running inside the foreign sandbox."""
    from mirage import MountMode, Workspace
    from mirage.fuse.fs import MirageFS
    from mirage.fuse.mount import load_fuse
    from mirage.types import ReadPolicy, ReadSpec
    from mirage.vfs.s3 import S3VFS, S3Config

    config = S3Config(**json.loads(Path(config_path).read_text()))
    workspace = Workspace({'/work': S3VFS(config)},
                          mode=MountMode.EXEC,
                          read=ReadSpec(policy=ReadPolicy.FRESH))
    filesystem = MirageFS(workspace.vfs, root_prefix='/work')
    try:
        load_fuse().FUSE(filesystem,
                         '/work',
                         foreground=True,
                         nothreads=True,
                         allow_other=True,
                         direct_io=True,
                         attr_timeout=0,
                         entry_timeout=0,
                         negative_timeout=0)
    finally:
        # S3 connections were created on MountCore's loop. Close there too.
        filesystem.core._run(workspace.close())


if __name__ == '__main__':
    import sys
    mount_main(sys.argv[1])
