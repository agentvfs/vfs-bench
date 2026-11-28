import json
import os
import shlex
import unittest
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.policy import SMTP

from vfsbench import Toolathlon, TrialConfig


@unittest.skipUnless(
    os.getenv('VFSBENCH_TEST_SNAPSHOT')
    and os.getenv('VFSBENCH_TEST_WOOCOMMERCE'),
    'requires private microVMs and the cached Toolathlon Woo/GCP fixtures')
class WelcomeTest(unittest.IsolatedAsyncioTestCase):

    async def test_new_customers_receive_mail_and_crm_updates(self):
        task = Toolathlon(
            local_files_only=True, cache_dir=os.getenv(
                'VFSBENCH_TEST_CACHE'))['woocommerce-new-welcome']
        config = TrialConfig(snapshot=os.environ['VFSBENCH_TEST_SNAPSHOT'])
        for complete in (False, True):
            async with task.start(config=config) as trial:

                async def shell(command):
                    result = await trial.exec(command)
                    self.assertEqual(result.return_code, 0,
                                     result.stderr + result.stdout)
                    return result.stdout

                state = await trial.service_state('bigquery')
                self.assertEqual(len(state['rows']), 50)
                old = {
                    (r['first_name'], r['last_name']): r['woocommerce_id']
                    for r in state['rows']
                }
                orders = json.loads(
                    await shell("woocommerce orders-list '{\"perPage\":100}'"))
                self.assertEqual(len(orders), 12)
                self.assertEqual(len((await shell('ls /woo/orders')).split()),
                                 12)
                template = await shell(
                    'cat /workspace/welcome_email_template.md')
                count = 0
                for order in orders:
                    meta = {
                        item['key']: item['value']
                        for item in order['meta_data']
                    }
                    original = datetime.fromisoformat(
                        meta['original_date_created']).replace(tzinfo=UTC)
                    if order['status'] != 'completed' or datetime.now(
                            UTC) - original > timedelta(days=7):
                        continue
                    count += 1
                    contact = order['billing']
                    first, last, email = (contact[k]
                                          for k in ('first_name', 'last_name',
                                                    'email'))
                    sql = (
                        'INSERT INTO woocommerce_crm.customers '
                        '(id,woocommerce_id,first_name,last_name,email,'
                        'welcome_email_sent,welcome_email_date) VALUES '
                        f'({count+50},{old[first, last]},{json.dumps(first)},'
                        f'{json.dumps(last)},'
                        f'{json.dumps(email)},TRUE,CURRENT_TIMESTAMP())')
                    await shell('google-cloud bigquery-run-query ' +
                                shlex.quote(json.dumps({'query': sql})))
                    if complete:
                        message = EmailMessage(policy=SMTP)
                        message['From'] = 'christine.murphy91@mcp.com'
                        message['To'] = email
                        message['Subject'] = (
                            'Welcome to our store! Exclusive offers '
                            'await you')
                        body = template.split('## Email Body')[1]
                        for key, value in {
                                'customer_name': first + ' ' + last,
                                'order_id': str(order['id']),
                                'order_total': order['total'],
                                'order_date': order['date_created']
                        }.items():
                            body = body.replace('{{' + key + '}}', value)
                        message.set_content(body)
                        await trial.workspace.vfs.write(
                            '/workspace/welcome.eml', message.as_bytes())
                        await shell(
                            'cat /workspace/welcome.eml | himalaya message '
                            'send')
                self.assertEqual(count, 10)
                self.assertEqual(
                    len((await trial.service_state('bigquery'))['rows']), 60)
                self.assertEqual(
                    len((await trial.service_state('mail')
                         )['christine.murphy91']['Sent']),
                    10 if complete else 0)
                self.assertEqual((await trial.verify()).reward,
                                 float(complete))
