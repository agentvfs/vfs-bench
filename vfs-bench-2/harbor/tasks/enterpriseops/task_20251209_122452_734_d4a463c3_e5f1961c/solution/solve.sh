#!/usr/bin/env bash
# A solution of task_20251209_122452_734_d4a463c3_e5f1961c, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0001127
sn-csm-server get-accounts --account-id 49
sn-csm-server find-product-by-id --product-id 165
sn-csm-server find-entitlements --account-id 49 --active true
sn-csm-server update-case --case-id 1127 --state in_progress
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 1127 --sla-def-id 1 --stage in_progress
sn-csm-server link-new-case-sla --case-id 1127 --sla-def-id 6 --stage in_progress
sn-csm-server search-cases --number CS-0000888
sn-csm-server get-accounts --account-id 38
sn-csm-server update-case --case-id 888 --priority high
sn-csm-server update-case --case-id 888 --state resolved
