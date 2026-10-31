#!/usr/bin/env bash
# A solution of task_20260105_221816_258_00364ece_50f56980, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user-group --name 'Case Triage'
sn-csm-server get-cases-assigned-to --assignment-group-id 3
sn-csm-server list-users --first-name Jason
sn-csm-server find-user-group --name 'Proactive Case Monitoring_4'
sn-csm-server check-user-membership --user-id 173 --group-id 71
sn-csm-server add-new-group-member --group-id 71 --user-id 173
sn-csm-server update-case --case-id 1010 --assignment-group-id 71 --assigned-to 173
sn-csm-server send-notification --case-id 1010 --email jason.smith10@servicenow.com --type report
