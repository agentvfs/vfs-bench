#!/usr/bin/env bash
# A solution of task_20251205_072016_336_46ca2862_e9006fbb, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Tabitha Bullock'
sn-csm-server find-user-by-email --email mckenzie.mendez@servicenow.com
sn-csm-server get-cases-assigned-to --assigned-to 3
sn-csm-server check-user-membership --user-id 3 --group-id 67
sn-csm-server check-user-membership --user-id 5 --group-id 67
sn-csm-server add-new-group-member --group-id 67 --user-id 5
sn-csm-server update-case --case-id 251 --assigned-to 5
sn-csm-server update-case --case-id 1142 --assigned-to 5
sn-csm-server remove-group-membership --member-id 407
sn-csm-server update-user-details --user-id 3 --active false
sn-csm-server send-notification --case-id 251 --email mckenzie.mendez@servicenow.com --type update
sn-csm-server send-notification --case-id 1142 --email mckenzie.mendez@servicenow.com --type update
