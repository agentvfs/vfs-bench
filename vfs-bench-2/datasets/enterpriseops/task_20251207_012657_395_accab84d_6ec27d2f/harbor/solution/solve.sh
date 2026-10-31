#!/usr/bin/env bash
# A solution of task_20251207_012657_395_accab84d_6ec27d2f, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Initech
sn-csm-server find-user --name 'Thomas Bailey'
sn-csm-server find-contact-by-portal-user --portal-user-id 63
sn-csm-server find-product --name 'Apache HTTP Server Variant 10'
sn-csm-server search-cases --account-id 5 --contact-id 5 --product-id 30
sn-csm-server find-user --name 'Michael Lee'
sn-csm-server find-user-group --name 'CSM Tier 1 Support'
sn-csm-server check-user-membership --user-id 228 --group-id 1
sn-csm-server update-case --case-id 108 --state new --reopen-count 1
sn-csm-server update-case --case-id 108 --assignment-group-id 1 --assigned-to 228
sn-csm-server update-case --case-id 108 --state in_progress
sn-csm-server find-case-knowledge-linkages --case-id 108
sn-csm-server delete-case-knowledge-linkages --case-kb-id 41
sn-csm-server find-product --name 'Apache HTTP Server Variant 90'
sn-csm-server retrieve-knowledge --product-id 110 --state published
sn-csm-server link-case-knowledge --case-id 108 --knowledge-id 170 --used-as suggested
