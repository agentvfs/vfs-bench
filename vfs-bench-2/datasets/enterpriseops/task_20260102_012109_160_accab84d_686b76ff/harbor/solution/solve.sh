#!/usr/bin/env bash
# A solution of task_20260102_012109_160_accab84d_686b76ff, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Tonya Stevens'
sn-csm-server find-contact-by-portal-user --portal-user-id 287
sn-csm-server search-cases --number CS-0000193
sn-csm-server find-product-by-id --product-id 140
sn-csm-server find-entitlements --account-id 8 --product-id 140
sn-csm-server find-user-group --name 'Escalation Management'
sn-csm-server update-entitlement --entitlement-id 73 --support-level enterprise --coverage-hours h24x7
sn-csm-server update-case --case-id 193 --priority critical --escalation true --escalation-reason impact --assignment-group-id 18 --state in_progress --reopen-count 1
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 193 --sla-def-id 1 --stage in_progress
sn-csm-server link-new-case-sla --case-id 193 --sla-def-id 6 --stage in_progress
sn-csm-server retrieve-knowledge --product-id 140 --state published
sn-csm-server link-case-knowledge --case-id 193 --knowledge-id 210 --used-as suggested
