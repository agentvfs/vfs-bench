#!/usr/bin/env bash
# A solution of task_20251206_113950_467_6cd2e092_1a268d87, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Denise Hawkins'
sn-csm-server find-account --name 'Larson PLC'
sn-csm-server find-contacts --account-id 22 --portal-user-id 7
sn-csm-server find-product --name 'Apache HTTP Server Variant 70'
sn-csm-server search-cases --account-id 22 --product-id 90
sn-csm-server find-user --name 'Christine Evans'
sn-csm-server find-user-group --name 'CSM Tier 1 Support'
sn-csm-server check-user-membership --user-id 123 --group-id 1
sn-csm-server update-case --case-id 486 --state new --reopen-count 1 --channel email --contact-id 38
sn-csm-server set-case-assignment-group --case-id 486 --assignment-group-id 1
sn-csm-server assign-case-to-user --case-id 486 --assigned-to-user-id 123
