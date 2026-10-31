#!/usr/bin/env bash
# A solution of task_20260106_161859_265_00364ece_0e836ce8, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Thomas Bailey'
sn-csm-server find-contact-by-portal-user --portal-user-id 63
sn-csm-server find-product --name 'Managed Network Services Variant 17'
sn-csm-server find-entitlements --account-id 5 --product-id 209
sn-csm-server find-user --name 'David Smith'
sn-csm-server find-user --name 'Denise Watson'
sn-csm-server get-cases-assigned-to --assigned-to 344
sn-csm-server get-cases-assigned-to --assigned-to 714
sn-csm-server get-cases-assigned-to --assigned-to 336
sn-csm-server find-user-group --name 'CSM Tier 1 Support_2'
sn-csm-server check-user-membership --user-id 344 --group-id 21
sn-csm-server add-new-group-member --group-id 21 --user-id 344
sn-csm-server create-new-case --account-id 5 --contact-id 5 --product-id 209 --channel email --priority high --state new --short-description 'Product: Managed Network Services Variant 17, Issue: performance degrades under heavy load.' --assignment-group-id 21 --assigned-to 344
sn-csm-server retrieve-knowledge --product-id 209 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 315 --used-as suggested
sn-csm-server send-notification --case-id 1233 --email thomas.bailey63@initech.io --type report
