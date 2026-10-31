#!/usr/bin/env bash
# A solution of task_20260106_133642_894_66392a82_3e083fa5, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Derek Blake'
sn-csm-server update-user-details --user-id 622 --active true
sn-csm-server find-contact-by-portal-user --portal-user-id 622
sn-csm-server find-user --name 'Alexandra Hansen'
sn-csm-server search-cases --contact-id 3 --state closed
sn-csm-server list-user-groups --name 'Account Management'
sn-csm-server list-group-members --group-id 7
sn-csm-server list-users --user-id 72 --role manager --active true
sn-csm-server update-case --case-id 88 --state new --reopen-count 1
sn-csm-server update-case --case-id 88 --assignment-group-id 7 --assigned-to 72 --state in_progress
