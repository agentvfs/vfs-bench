#!/usr/bin/env bash
# A solution of task_20251211_192109_853_99ba2325_b21298a0, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000513
sn-csm-server find-entitlements --account-id 23 --active true
sn-csm-server retrieve-knowledge --product-id 198 --limit 5
sn-csm-server link-case-knowledge --case-id 513 --knowledge-id 300 --used-as suggested
sn-csm-server update-case --case-id 513 --state in_progress
sn-csm-server find-sla-definitions --applies-to-priority moderate --active true
sn-csm-server link-new-case-sla --case-id 513 --sla-def-id 3 --stage in_progress
sn-csm-server link-new-case-sla --case-id 513 --sla-def-id 12 --stage in_progress
sn-csm-server find-contacts --contact-id 44
sn-csm-server list-users --user-id 626
sn-csm-server send-notification --case-id 513 --knowledge-id 300 --email christopher.lee94@clarkandsons.com --type alert
