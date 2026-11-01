#!/usr/bin/env bash
# A solution of task_20251210_051952_801_99ba2325_a136867b, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Acme Systems'
sn-csm-server find-product --name 'Atlassian Jira Data Center Variant 77'
sn-csm-server search-cases --account-id 3 --product-id 97 --state resolved
sn-csm-server update-case --case-id 62 --state new --reopen-count 1
sn-csm-server retrieve-knowledge --search-text Jira --product-id 97
sn-csm-server link-case-knowledge --case-id 62 --knowledge-id 145 --used-as applied
sn-csm-server find-user --name 'Jennifer Elliott'
sn-csm-server find-user-group --name 'Case Assignment'
sn-csm-server check-user-membership --user-id 439 --group-id 4
sn-csm-server update-case --case-id 62 --assignment-group-id 4
sn-csm-server assign-case-to-user --case-id 62 --assigned-to-user-id 439
sn-csm-server update-case --case-id 62 --state in_progress
