#!/usr/bin/env bash
# A solution of task_20260106_090444_873_99ba2325_980a3405, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000842
sn-csm-server find-product-by-id --product-id 173
sn-csm-server find-case-knowledge-linkages --case-id 842
sn-csm-server retrieve-knowledge --product-id 173
sn-csm-server find-contacts --account-id 37 --is-primary true
sn-csm-server list-users --user-id 82
sn-csm-server send-notification --case-id 842 --knowledge-id 257 --email carl.brown91@cainryanandduncan.com --type solution_proposal
sn-csm-server find-case-slas --case-id 842
sn-csm-server update-case --case-id 842 --escalation true --escalation-reason breach_risk
