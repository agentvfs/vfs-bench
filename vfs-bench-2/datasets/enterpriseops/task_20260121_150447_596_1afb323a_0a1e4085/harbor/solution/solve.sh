#!/usr/bin/env bash
# A solution of task_20260121_150447_596_1afb323a_0a1e4085, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Initech
sn-csm-server find-product --name 'Cisco ASA 5525-X Variant 42'
sn-csm-server search-cases --account-id 5 --product-id 174 --state in_progress
sn-csm-server retrieve-installed-products --installed-product-id 25
sn-csm-server find-locations --location-id 812
sn-csm-server find-locations --plot-no 'Plot 551' --city tokyo
sn-csm-server list-users --location-id 219 --role agent --active true
sn-csm-server find-entitlements --account-id 5 --active true
sn-csm-server check-user-membership --user-id 219 --group-id 36
sn-csm-server add-new-group-member --group-id 36 --user-id 219
sn-csm-server update-case --case-id 122 --priority high --escalation true --escalation-reason customer_request --assigned-to 219
sn-csm-server find-case-slas --case-id 122
sn-csm-server find-sla-definitions --applies-to-priority high --active true
sn-csm-server delete-case-slas --case-sla-id 243
sn-csm-server delete-case-slas --case-sla-id 244
sn-csm-server link-new-case-sla --case-id 122 --sla-def-id 11 --stage in_progress
sn-csm-server link-new-case-sla --case-id 122 --sla-def-id 7 --stage in_progress
