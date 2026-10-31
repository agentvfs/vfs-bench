#!/usr/bin/env bash
# A solution of task_20251231_164213_376_00364ece_724e98d5, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Diana Johnson'
sn-csm-server get-cases-assigned-to --assigned-to 15
sn-csm-server find-user --name 'Casey Green'
sn-csm-server find-user-group --name 'Case Assignment_3'
sn-csm-server check-user-membership --user-id 52 --group-id 44
sn-csm-server add-new-group-member --group-id 44 --user-id 52
sn-csm-server update-case --case-id 179 --assignment-group-id 44 --assigned-to 52
sn-csm-server update-user-details --user-id 15 --active false
sn-csm-server find-contacts --contact-id 10
sn-csm-server list-users --user-id 20
sn-csm-server send-notification --case-id 179 --email marc.henry@stark-industries.com --type report
