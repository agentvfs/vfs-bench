import base64
import json
import runpy
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace


def module(name):
    return sys.modules.setdefault(name, ModuleType(name))


def main():
    sys.path.insert(0, str(Path('code').resolve()))
    from utils.app_specific.poste import ops
    accounts = json.loads(Path('mail.json').read_bytes())
    crm = json.loads(Path('crm.json').read_bytes())

    class Mailbox:

        def __init__(self, config):
            self.folders = accounts[config['email'].split('@')[0]]

        def select(self, name):
            self.messages = self.folders[name]
            return 'OK', [str(len(self.messages)).encode()]

        def search(self, charset, criterion):
            if charset is not None or criterion != 'ALL':
                raise ValueError('Unexpected upstream IMAP search')
            return 'OK', [
                ' '.join(str(i)
                         for i in range(1,
                                        len(self.messages) + 1)).encode()
            ]

        def fetch(self, number, selector):
            if selector != '(RFC822)':
                raise ValueError('Unexpected upstream IMAP selector')
            return 'OK', [
                (selector.encode(),
                 base64.b64decode(self.messages[int(number) - 1]['rfc822']))
            ]

    ops._connect_imap, ops._close_imap_safely = Mailbox, lambda mailbox: None
    auth = module('google.oauth2.service_account')
    auth.Credentials = SimpleNamespace(
        from_service_account_file=lambda path: None)
    module('google.oauth2').service_account = auth
    sdk = module('google.cloud.bigquery')
    module('google.cloud').bigquery = sdk
    sdk.QueryJobConfig = SimpleNamespace
    sdk.ScalarQueryParameter = lambda name, kind, value: SimpleNamespace(
        name=name, value=value)

    class Client:

        def __init__(self, **kwargs):
            self.table = kwargs['project'] + '.woocommerce_crm.customers'

        def query(self, sql, job_config=None):
            if 'error' in crm:
                raise ValueError(crm['error'])
            rows = crm['rows']
            all_rows = f'SELECT * FROM `{self.table}`'
            if sql == all_rows + ' WHERE email = @email':
                parameter, = job_config.query_parameters
                if parameter.name != 'email':
                    raise ValueError('Unexpected CRM parameter')
                rows = [row for row in rows if row['email'] == parameter.value]
            elif sql != all_rows:
                raise ValueError('Unexpected CRM query from pinned grader')
            return SimpleNamespace(result=lambda: rows)

    sdk.Client = Client
    module('token_key_session').all_token_key_session = SimpleNamespace(
        emails_config_file='code/emails_config.json')
    module('utils.evaluation.retry').grade_with_retry = lambda check: check()
    sys.argv = ['evaluation.main']
    try:
        runpy.run_module('evaluation.main', run_name='__main__')
    except SystemExit as exc:
        if exc.code == 1:
            return 10
        if exc.code not in {None, 0}:
            raise
    return 0


if __name__ == '__main__':
    sys.exit(main())
