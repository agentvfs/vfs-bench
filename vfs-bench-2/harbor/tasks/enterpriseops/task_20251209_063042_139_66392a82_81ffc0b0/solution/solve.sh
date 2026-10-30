#!/usr/bin/env bash
# A solution of task_20251209_063042_139_66392a82_81ffc0b0, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Derek Blake'
sn-csm-server find-contact-by-portal-user --portal-user-id 622
sn-csm-server search-cases --contact-id 3 --state closed
sn-csm-server find-entitlements --account-id 4 --active true
sn-csm-server list-user-groups --name 'Installed Base Support'
sn-csm-server list-group-members --group-id 10
sn-csm-server list-users --role manager --active true
sn-csm-server update-case --case-id 88 --state in_progress --channel email --priority critical --reopen-count 2 --assignment-group-id 10 --assigned-to 111
sn-csm-server list-user-groups --name 'Proactive Case Monitoring'
sn-csm-server list-group-members --group-id 11
sn-csm-server send-notification --case-id 88 --email christopher.johnson@servicenow.com --type update
