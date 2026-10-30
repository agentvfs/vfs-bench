#!/usr/bin/env bash
# A solution of task_20251205_075543_102_46ca2862_7ba653d0, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000002
sn-csm-server retrieve-knowledge --product-id 130 --limit 5
sn-csm-server update-knowledge --knowledge-id 197 --state published
sn-csm-server link-case-knowledge --case-id 2 --knowledge-id 197 --used-as suggested
sn-csm-server find-user --name 'Joanne Simpson'
sn-csm-server find-user-group --name 'Case Management'
sn-csm-server add-new-user-group --name 'Case Management' --type support --active true
sn-csm-server add-new-group-member --group-id 81 --user-id 4
sn-csm-server update-case --case-id 2 --assignment-group-id 81 --assigned-to 4 --state pending
