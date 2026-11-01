#!/usr/bin/env bash
# A solution of task_20251204_132620_055_5c0cd3a2_048c6e95, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Michael Ward'
sn-csm-server find-account --name 'Acme Systems'
sn-csm-server find-contact-by-portal-user --portal-user-id 47
sn-csm-server search-cases --account-id 3 --contact-id 1 --channel alert --state new
sn-csm-server list-user-groups --name 'CSM Tier 2 Support'
sn-csm-server find-user --name 'Travis Wood'
sn-csm-server check-user-membership --user-id 11 --group-id 2
sn-csm-server add-new-group-member --group-id 2 --user-id 11
sn-csm-server update-case --case-id 71 --assignment-group-id 2 --assigned-to 11 --priority high --state in_progress --escalation true --escalation-reason impact
sn-csm-server find-product --name 'Atlassian Jira Data Center Variant 77'
sn-csm-server find-entitlements --account-id 3 --product-id 97
sn-csm-server update-entitlement --entitlement-id 22 --support-level premium --coverage-hours h12x6 --max-cases-per-month 30
