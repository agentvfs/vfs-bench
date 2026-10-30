#!/usr/bin/env bash
# A solution of task_20260121_143201_590_1afb323a_5a03bf03, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server add-location --name 'Servicenow Office - Mumbai' --plot-no 1234 --street 'JM Road' --city mumbai --country india --active true
sn-csm-server add-new-user-group --name 'OOPS Issues Team' --type support --active true
sn-csm-server add-new-product --name 'ServiceNow OOOP' --category software --lifecycle-state active
sn-csm-server find-user --name 'Travis Wood'
sn-csm-server update-user-details --user-id 11 --location-id 907
sn-csm-server list-group-members --user-id 11
sn-csm-server remove-group-membership --member-id 172
sn-csm-server remove-group-membership --member-id 549
sn-csm-server add-new-group-member --group-id 81 --user-id 11
