"""Run the welcome workflow with private WooCommerce, BigQuery and mail.

WooCommerce and BigQuery use the suite's pinned Docker images. The order
generator runs in an offline microVM. Mirage captures mail for the fixture's
off-domain recipients in the sender's Sent folder, which the grader inspects.
"""

import ast
import asyncio
import hashlib
import json
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from ..runtime import TrialEnvironment, VerifierGuest
from ..verifier import SuiteVerifier
from . import _toolathlon_bigquery as bq
from . import _toolathlon_woocommerce as woo
from . import _woocommerce_inventory as inventory
from ._toolathlon_mail import mail_server
from ._woocommerce_store import serve as serve_store

ID = 'woocommerce-new-welcome'
MANIFEST = 'e8dc909c3c895ee4264b5f4332516523e975054684b3632bb931f8bc0adff452'
SOURCE = ('https://raw.githubusercontent.com/hkust-nlp/Toolathlon/'
          '9be8d8fe07a497b18ee61e3f2ae694e9797f39eb/')
HELPERS = {
    'utils/app_specific/woocommerce/order_generator.py':
    (19861,
     'bde2047f9436a7f55781085e36a886f7e004cdd2443e2a2baebcae76a3bf8efe'),
    'utils/app_specific/poste/checks.py':
    (7953, 'bb5c01e7f126a282bcc65e3d80e6067b720ed72ab0a5075380fba73707fe9ebe'),
    'utils/app_specific/poste/ops.py':
    (16993,
     '4d782d28208a04ec4b8640cfd44550a5e2121c462400ca051d0e16bd94fbdae6'),
}
CRM = 'woocommerce_crm'
SCHEMA = [('id', 'INTEGER'),
          ('woocommerce_id', 'INTEGER'), ('email', 'STRING'),
          ('first_name', 'STRING'), ('last_name', 'STRING'),
          ('phone', 'STRING'), ('date_created', 'TIMESTAMP'),
          ('first_order_date', 'TIMESTAMP'), ('welcome_email_sent', 'BOOLEAN'),
          ('welcome_email_date', 'TIMESTAMP'), ('sync_date', 'TIMESTAMP'),
          ('metadata', 'STRING')]
GENERATOR = """import json, sys
from contextlib import redirect_stdout
sys.path.insert(0, 'utils/app_specific/woocommerce')
import order_generator as generator
with redirect_stdout(sys.stderr):
    orders, first = generator.create_new_welcome_orders(seed=42)
    convert = generator.OrderDataGenerator().create_woocommerce_order_data
    print_rows = [convert(row, virtual_product_id=1) for row in orders]
print(json.dumps(print_rows))
"""


def _inputs(task):
    digest = hashlib.sha256(
        json.dumps(task.manifest, sort_keys=True,
                   separators=(',', ':')).encode()).hexdigest()
    if digest != MANIFEST:
        raise ValueError('Unexpected welcome-task release')
    paths = [
        'upstream/' + name
        for name in ('evaluation/main.py', 'emails_config.json',
                     'preprocess/woocommerce_data.json',
                     'preprocess/customers_data.json',
                     'initial_workspace/welcome_email_template.md')
    ]
    files = {
        key.removeprefix('upstream/'): path.read_bytes()
        for key, path in task.files(paths).items()
    }
    for key, (size, sha256) in HELPERS.items():
        files[key] = task._dataset._source_file({
            'url':
            SOURCE + key,
            'size':
            size,
            'sha256':
            sha256,
            'path':
            'vfs-bench-1/submodule/Toolathlon/' + key
        }).read_bytes()
    return files


async def _initialize_store(task, config, inputs, account, store, sql_cli,
                            hashed):
    await inventory.create_site(task,
                                store,
                                sql_cli,
                                hashed,
                                title="Christine Murphy's Store",
                                email=account)
    folder = 'tasks/finalpool/' + ID + '/preprocess/'
    generator = 'utils/app_specific/woocommerce/order_generator.py'
    files = {generator: inputs[generator], 'generate.py': GENERATOR.encode()}
    for name in ('customers_data.json', 'woocommerce_data.json'):
        files[folder + name] = inputs['preprocess/' + name]
    async with VerifierGuest(config) as guest:
        result = await guest.run(files, ['python3', '-I', 'generate.py'])
    if result.return_code:
        raise RuntimeError('Original order generation failed: ' +
                           result.stderr[-1000:])
    payloads = json.loads(result.stdout)
    if len(payloads) != 12:
        raise ValueError(
            'Unexpected order count from original welcome generator')
    for order in payloads:
        status, _, response = await store.request(
            'POST', 'orders', body=json.dumps(order).encode())
        if status != 201:
            raise RuntimeError(
                f'WooCommerce rejected an original order ({status}): '
                f'{response[:400]!r}')


async def _initialize_crm(warehouse, inputs):
    rows = json.loads(inputs['preprocess/customers_data.json'])
    fields = [{
        'name': key,
        'type': kind,
        'mode': 'REQUIRED' if index < 3 else 'NULLABLE'
    } for index, (key, kind) in enumerate(SCHEMA)]
    base = '/datasets/' + CRM + '/tables'
    await warehouse.request(
        base, {
            'tableReference': {
                'projectId': bq.PROJECT,
                'datasetId': CRM,
                'tableId': 'customers'
            },
            'schema': {
                'fields': fields
            }
        })
    for row in rows:
        for key, kind in SCHEMA:
            if kind == 'TIMESTAMP' and row[key]:
                value = datetime.fromisoformat(row[key])
                row[key] = (value if value.tzinfo else value.replace(
                    tzinfo=UTC)).isoformat()
    response = await warehouse.request(
        base + '/customers/insertAll',
        {'rows': [{
            'json': row
        } for row in rows]})
    if len(rows) != 50 or response.get('insertErrors'):
        raise ValueError(
            'The original 50-row CRM fixture could not be restored')


def _verifier_inputs(inputs, account):
    staged = {
        'driver.py':
        Path(__file__).with_name('_welcome_grader.py').read_bytes(),
        'code/evaluation/__init__.py':
        b'',
        'configs/gcp-service_account.keys.json':
        json.dumps({
            'project_id': bq.PROJECT
        }).encode(),
        'code/emails_config.json':
        json.dumps({
            'email': account
        }).encode()
    }
    for name in ('evaluation/main.py',
                 'initial_workspace/welcome_email_template.md',
                 'preprocess/woocommerce_data.json',
                 'preprocess/customers_data.json',
                 'utils/app_specific/poste/checks.py'):
        staged['code/' + name] = inputs[name]
    source = inputs['utils/app_specific/poste/ops.py'].decode()
    decoders = {
        '_decode_mime_words', '_extract_text_from_message', '_strip_html',
        'decode_email_subject'
    }
    functions = [
        ast.get_source_segment(source, fn) for fn in ast.parse(source).body
        if isinstance(fn, ast.FunctionDef) and fn.name in decoders
    ]
    if len(functions) != len(decoders):
        raise ValueError('Unexpected original mail decoding helpers')
    staged['code/utils/app_specific/poste/ops.py'] = (
        'import email.message, email.header\nfrom email.header import '
        'decode_header\n' + '\n\n'.join(functions)).encode()
    return staged


@asynccontextmanager
async def prepare(task, config, run_dir):
    inputs = await asyncio.to_thread(_inputs, task)
    account = json.loads(inputs['emails_config.json'])['email']
    workspace_dir = run_dir / 'workspace'
    workspace_dir.mkdir()
    (workspace_dir / 'welcome_email_template.md').write_bytes(
        inputs['initial_workspace/welcome_email_template.md'])

    async def initialize(store, sql_cli, hashed):
        await _initialize_store(task, config, inputs, account, store, sql_cli,
                                hashed)

    async with AsyncExitStack() as stack:
        store, url = await stack.enter_async_context(
            serve_store(task, site='store88', initialize=initialize))
        install_store = await stack.enter_async_context(
            woo.tools(task, store, url, run_dir))
        warehouse = await stack.enter_async_context(
            bq.serve(task, run_dir, config, empty_dataset=CRM))
        await _initialize_crm(warehouse, inputs)
        settings, mail_state = await stack.enter_async_context(
            mail_server(task._dataset, run_dir, [account],
                        int(datetime.now(UTC).timestamp() * 1000)))
        access = {
            **settings, 'username': account,
            'save_copy': True,
            'sent_folder': 'Sent'
        }
        workspace = {
            'mounts': {
                '/mail': {
                    'vfs': 'email',
                    'mode': 'read',
                    'config': access
                }
            },
            'clis': {
                'himalaya': {
                    'cli': 'himalaya',
                    'machine': 'in_process',
                    'config': access
                }
            },
            'network': {
                'allowed_domains': [
                    f'127.0.0.1:{settings[k]}'
                    for k in ('imap_port', 'smtp_port')
                ]
            }
        }

        async def install(ws):
            await install_store(ws)
            await warehouse.install(ws)

        async def crm_state():
            try:
                result = await warehouse.query(
                    'SELECT * FROM `woocommerce_crm.customers`', limit=100000)
            except ValueError as exc:
                return {'rows': [], 'error': str(exc)}
            rows = bq._rows(result)
            if len(rows) != int(result.get('totalRows', 0)):
                raise ValueError('Incomplete welcome-task CRM snapshot')
            return {
                'rows': rows,
                'schema': result.get('schema', {}).get('fields', [])
            }

        async def evaluate(view):
            files = _verifier_inputs(inputs, account)
            files['mail.json'] = json.dumps(
                await view.service_state('mail')).encode()
            files['crm.json'] = json.dumps(
                await view.service_state('bigquery')).encode()
            async with VerifierGuest(config) as guest:
                result = await guest.run(files, ['python3', '-I', 'driver.py'])
            if result.return_code not in (0, 10):
                raise RuntimeError('Welcome verifier failed: ' +
                                   (result.stderr + result.stdout)[-1700:])
            return {
                'reward': int(result.return_code == 0),
                'grader': 'toolathlon/evaluation/main.py'
            }

        instructions = (
            f'Your store mailbox is {account}. Read /woo/orders and '
            f'/workspace/welcome_email_template.md. '
            'Use woocommerce to query the store, google-cloud '
            'bigquery-run-query to update the CRM and '
            'himalaya message send to send RFC 822 messages. Inspect sent '
            'messages under /mail/Sent.')
        yield TrialEnvironment(workspace,
                               SuiteVerifier(evaluate),
                               instructions,
                               install=install,
                               state_readers={
                                   'woocommerce': store.state,
                                   'bigquery': crm_state,
                                   'mail': mail_state
                               })
