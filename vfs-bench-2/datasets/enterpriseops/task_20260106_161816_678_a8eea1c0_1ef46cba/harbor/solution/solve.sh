#!/usr/bin/env bash
# A solution of task_20260106_161816_678_a8eea1c0_1ef46cba, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000783
sn-csm-server find-user --name 'Ashley Krueger'
sn-csm-server find-user --name 'Thomas Green'
sn-csm-server update-user-details --user-id 1 --active true
sn-csm-server check-user-membership --user-id 1 --group-id 1
sn-csm-server add-new-group-member --group-id 1 --user-id 1
sn-csm-server find-entitlements --account-id 34 --product-id 35 --active true
sn-csm-server update-case --case-id 783 --assigned-to 1 --state in_progress
sn-csm-server find-sla-definitions --metric resolution --applies-to-priority critical
sn-csm-server update-sla-definition --sla-def-id 6 --target-mins 360
sn-csm-server link-new-case-sla --case-id 783 --sla-def-id 6 --stage in_progress
sn-csm-server list-users --email thomas.clark70@servicenow.com
sn-csm-server register-new-interaction --channel email --account-id 34 --contact-id 73 --case-id 783 --interacted-user 576 --status handled
sn-csm-server add-new-user-group --name 'Security Policy Review' --type support --active true
sn-csm-server add-new-user --first-name Lisa --last-name Casey --email lisa.casey@servicenow.com --role agent --active true
sn-csm-server add-new-group-member --group-id 81 --user-id 803
sn-csm-server add-new-product --name 'Advanced Security Module' --category software --lifecycle-state active
