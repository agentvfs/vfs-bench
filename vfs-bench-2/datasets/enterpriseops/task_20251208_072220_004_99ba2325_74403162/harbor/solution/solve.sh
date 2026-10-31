#!/usr/bin/env bash
# A solution of task_20251208_072220_004_99ba2325_74403162, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-location --name 'Reyes Inc Site A - New York'
sn-csm-server add-new-user --first-name Oliver --last-name Oats --email oliver.oats@servicenow.com --role agent --location-id 832 --active true
sn-csm-server list-user-groups --name 'Case Assignment'
sn-csm-server add-new-group-member --group-id 4 --user-id 803
sn-csm-server search-cases --number CS-0000001
sn-csm-server update-case --case-id 1 --state in_progress --assignment-group-id 4 --assigned-to 803
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server find-case-slas --case-id 1
sn-csm-server update-case-sla-details --case-sla-id 1 --stage in_progress --has-breached true
sn-csm-server update-case-sla-details --case-sla-id 2 --stage in_progress --has-breached true
