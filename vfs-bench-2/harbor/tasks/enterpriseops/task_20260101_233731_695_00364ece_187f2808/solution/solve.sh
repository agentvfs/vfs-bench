#!/usr/bin/env bash
# A solution of task_20260101_233731_695_00364ece_187f2808, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Joanne Simpson'
sn-csm-server find-location --name 'TB State Building'
sn-csm-server add-location --name 'TB State Building' --active true --city sydney --country australia
sn-csm-server update-user-details --user-id 4 --location-id 907
sn-csm-server find-user-group --name 'Proactive Case Monitoring_2'
sn-csm-server check-user-membership --user-id 4 --group-id 31
sn-csm-server add-new-group-member --group-id 31 --user-id 4
sn-csm-server search-cases --number CS-0000299
sn-csm-server update-case --case-id 299 --assignment-group-id 31 --assigned-to 4 --priority critical --escalation true --escalation-reason impact
sn-csm-server send-notification --case-id 299 --email joanne.simpson@servicenow.com --type update
