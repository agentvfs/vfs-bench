#!/usr/bin/env bash
# A solution of task_20260102_031908_712_accab84d_886a7365, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Zebra Partners'
sn-csm-server find-product --name 'Health Check & Optimization Variant 10'
sn-csm-server search-cases --account-id 2 --product-id 202
sn-csm-server find-entitlements --account-id 2 --product-id 202 --active true
sn-csm-server find-user-by-email --email amelia.jones@servicenow.com
sn-csm-server find-locations --name 'User 1 - New York'
sn-csm-server add-new-user --first-name Amelia --last-name Jones --email amelia.jones@servicenow.com --role agent --location-id 1 --active true
sn-csm-server find-user-group --name 'CSM Tier 2 Support'
sn-csm-server add-new-group-member --group-id 2 --user-id 803
sn-csm-server search-cases --number CS-0000032
sn-csm-server set-case-assignment-group --case-id 32 --assignment-group-id 2
sn-csm-server assign-case-to-user --case-id 32 --assigned-to-user-id 803
sn-csm-server update-case --case-id 32 --state in_progress --escalation true --escalation-reason breach_risk
sn-csm-server find-sla-definitions --name 'SLA Resolution - Critical'
sn-csm-server search-cases --number CS-0000030
sn-csm-server update-case --case-id 30 --state in_progress --escalation true --escalation-reason urgency
sn-csm-server search-cases --number CS-0000047
sn-csm-server update-case --case-id 47 --state resolved
sn-csm-server update-case --case-id 47 --state closed
