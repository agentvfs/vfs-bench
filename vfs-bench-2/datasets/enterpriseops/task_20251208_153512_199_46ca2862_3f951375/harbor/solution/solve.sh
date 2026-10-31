#!/usr/bin/env bash
# A solution of task_20251208_153512_199_46ca2862_3f951375, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Stephanie Todd'
sn-csm-server find-user --name 'Robin Monroe'
sn-csm-server get-cases-assigned-to --assigned-to 6
sn-csm-server check-user-membership --user-id 31 --group-id 50
sn-csm-server add-new-group-member --group-id 50 --user-id 31
sn-csm-server assign-case-to-user --case-id 525 --assigned-to-user-id 31
sn-csm-server check-user-membership --user-id 6 --group-id 50
sn-csm-server remove-group-membership --group-id 50 --user-id 6
sn-csm-server check-user-membership --user-id 6 --group-id 35
sn-csm-server remove-group-membership --group-id 35 --user-id 6
sn-csm-server update-user-details --user-id 6 --active false
