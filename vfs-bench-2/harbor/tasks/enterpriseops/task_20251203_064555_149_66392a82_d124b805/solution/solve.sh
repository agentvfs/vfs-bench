#!/usr/bin/env bash
# A solution of task_20251203_064555_149_66392a82_d124b805, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server list-user-groups --name 'Field Service Coordination'
sn-csm-server list-user-groups --type field --active true
sn-csm-server list-group-members --group-id 54
sn-csm-server list-users --role manager --user-id 518
sn-csm-server create-new-account --name 'Horizon Fleet Services' --account-type customer --active true
sn-csm-server add-new-user-group --name 'Horizon Field Response Coordination' --type field --active true
sn-csm-server add-new-group-member --group-id 81 --user-id 518
sn-csm-server remove-group-membership --member-id 54 --group-id 54 --user-id 518
