#!/usr/bin/env bash
# A solution of task_20260102_210829_972_2aa6b0ad_e3d70e04, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user-group --name 'Contact Center L2'
sn-csm-server list-group-members --group-id 9
sn-csm-server find-user --name 'Kurt Fritz'
sn-csm-server find-user --name 'Aaron Le'
sn-csm-server find-user --name 'Abraham George'
sn-csm-server find-location --name 'Zee Building'
sn-csm-server add-location --name 'Zee Building' --active true --city mumbai --country india
sn-csm-server add-new-user --first-name Abraham --last-name George --email abraham.george@servicenow.com --role admin --location-id 907 --active true
sn-csm-server add-new-group-member --group-id 9 --user-id 803
sn-csm-server remove-group-membership --member-id 9
sn-csm-server list-group-members --user-id 96
sn-csm-server remove-group-membership --member-id 126
sn-csm-server remove-group-membership --member-id 509
sn-csm-server remove-group-membership --member-id 799
sn-csm-server update-user-details --user-id 96 --active false
sn-csm-server list-group-members --user-id 91
sn-csm-server remove-group-membership --member-id 138
sn-csm-server remove-group-membership --member-id 521
sn-csm-server remove-group-membership --member-id 808
sn-csm-server remove-group-membership --member-id 931
sn-csm-server add-new-group-member --group-id 9 --user-id 91
