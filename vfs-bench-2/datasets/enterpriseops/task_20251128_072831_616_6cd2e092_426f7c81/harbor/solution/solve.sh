#!/usr/bin/env bash
# A solution of task_20251128_072831_616_6cd2e092_426f7c81, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Stark Industries'
sn-csm-server find-locations --city london --country uk
sn-csm-server search-cases --account-id 8 --channel alert
sn-csm-server find-user --name 'Tonya Stevens'
sn-csm-server find-contact-by-portal-user --portal-user-id 287
sn-csm-server list-user-groups --name 'CSM Tier 2 Support'
sn-csm-server find-sla-definitions --metric response --applies-to-priority high --pause-on-pending false
sn-csm-server find-case-slas --case-id 184
sn-csm-server update-case --case-id 184 --priority high --contact-id 11 --assignment-group-id 2
sn-csm-server link-new-case-sla --case-id 184 --sla-def-id 11 --stage in_progress
