#!/usr/bin/env bash
# A solution of task_20251202_052822_939_66392a82_0479926e, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server list-user-groups --name 'Installed Base Support'
sn-csm-server list-group-members --group-id 10
sn-csm-server list-users --role manager --active true
sn-csm-server create-new-account --name 'Lumina Healthcare' --account-type customer --active true
sn-csm-server add-new-user-group --name 'Lumina Implementation Coordination' --type support --active true
sn-csm-server add-new-group-member --group-id 81 --user-id 111
sn-csm-server add-new-group-member --group-id 81 --user-id 437
sn-csm-server add-new-group-member --group-id 81 --user-id 207
