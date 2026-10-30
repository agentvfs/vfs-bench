#!/usr/bin/env bash
# A solution of task_20260101_202840_239_a8eea1c0_0f425b23, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Sabrina Buckley'
sn-csm-server find-contact-by-portal-user --portal-user-id 262
sn-csm-server find-account --name 'Clark and Sons'
sn-csm-server search-cases --number CS-0000504
sn-csm-server find-product --name 'Managed Network Services Variant 41'
sn-csm-server update-case --case-id 504 --state new --reopen-count 1
sn-csm-server update-case --case-id 504 --priority critical --state in_progress
sn-csm-server find-user-group --name 'Escalation Management'
sn-csm-server set-case-assignment-group --case-id 504 --assignment-group-id 18
sn-csm-server find-user --name 'Liam O'"'"'Connell'
sn-csm-server add-new-user --first-name Liam --last-name 'O'"'"'Connell' --email liam.oconnell@servicenow.com --role agent --location-id 3 --active true
sn-csm-server add-new-group-member --group-id 18 --user-id 803
sn-csm-server assign-case-to-user --case-id 504 --assigned-to-user-id 803
sn-csm-server find-entitlements --account-id 23 --support-level enterprise --active true
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 504 --sla-def-id 1 --stage in_progress
sn-csm-server link-new-case-sla --case-id 504 --sla-def-id 6 --stage in_progress
sn-csm-server find-case-knowledge-linkages --case-id 504
sn-csm-server delete-case-knowledge-linkages --case-kb-id 216
sn-csm-server create-knowledge --title 'Failed Resolution Analysis - Managed Network Services Variant 41: Protocol Mismatch Root Cause' --state published --visibility internal --product-id 233 --owner-id 3 --body 'Prior fix failed on protocol mismatch. New strategy: align protocol versions end to end, then retest under load.'
sn-csm-server link-case-knowledge --case-id 504 --knowledge-id 370 --used-as suggested
