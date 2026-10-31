#!/usr/bin/env bash
# A solution of task_20260121_183027_058_1afb323a_c53cb400, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server list-users --email susan.adams075@servicenow.com
sn-csm-server add-new-user --first-name Susan --last-name Adams --email susan.adams075@servicenow.com --role agent --active true
sn-csm-server find-locations --plot-no 'Plot 685' --street 'Ferguson Neck' --city mumbai
sn-csm-server add-location --name 'User 803 - Mumbai' --active true --plot-no 'Plot 685' --street 'Ferguson Neck' --city mumbai --country india
sn-csm-server update-user-details --user-id 803 --location-id 907
sn-csm-server find-user --name 'Samuel Kemp'
sn-csm-server get-cases-assigned-to --assigned-to 38
sn-csm-server add-new-group-member --group-id 6 --user-id 803
sn-csm-server assign-case-to-user --case-id 223 --assigned-to-user-id 803
sn-csm-server assign-case-to-user --case-id 751 --assigned-to-user-id 803
sn-csm-server update-user-details --user-id 38 --active false
