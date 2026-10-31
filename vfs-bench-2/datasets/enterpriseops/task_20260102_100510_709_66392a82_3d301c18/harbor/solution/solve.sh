#!/usr/bin/env bash
# A solution of task_20260102_100510_709_66392a82_3d301c18, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server list-user-groups --name 'Entitlement Verification'
sn-csm-server list-group-members --group-id 5
sn-csm-server list-users --role manager --active true
sn-csm-server add-new-user-group --name 'Emergency Entitlement Oversight' --type support --active true
sn-csm-server add-new-group-member --group-id 81 --user-id 59
sn-csm-server add-new-group-member --group-id 81 --user-id 170
sn-csm-server add-new-group-member --group-id 81 --user-id 31
