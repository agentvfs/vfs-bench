#!/usr/bin/env bash
# A solution of task_20260101_162109_100_a8eea1c0_e88250ef, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000001
sn-csm-server find-user --name 'Thomas Green'
sn-csm-server find-user --name 'Tabitha Bullock'
sn-csm-server find-user-group --name 'CSM Tier 1 Support'
sn-csm-server check-user-membership --user-id 3 --group-id 1
sn-csm-server add-new-group-member --group-id 1 --user-id 3
sn-csm-server set-case-assignment-group --case-id 1 --assignment-group-id 1
sn-csm-server assign-case-to-user --case-id 1 --assigned-to-user-id 3
sn-csm-server find-entitlements --account-id 1 --active true
sn-csm-server update-case --case-id 1 --state in_progress --channel email
sn-csm-server find-case-slas --case-id 1
sn-csm-server find-sla-definitions --sla-def-id 6
sn-csm-server update-case-sla-details --case-sla-id 1 --stage in_progress
sn-csm-server update-case-sla-details --case-sla-id 2 --stage in_progress
sn-csm-server retrieve-knowledge --kb-number KB-0000195
sn-csm-server update-knowledge --knowledge-id 195 --state published
sn-csm-server search-cases --number CS-0000010
sn-csm-server find-case-knowledge-linkages --case-id 10 --knowledge-id 195
sn-csm-server delete-case-knowledge-linkages --case-kb-id 3
sn-csm-server link-case-knowledge --case-id 1 --knowledge-id 195 --used-as suggested
