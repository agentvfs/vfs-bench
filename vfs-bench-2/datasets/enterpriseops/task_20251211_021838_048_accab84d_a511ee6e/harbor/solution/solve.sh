#!/usr/bin/env bash
# A solution of task_20251211_021838_048_accab84d_a511ee6e, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000001
sn-csm-server find-user --name 'Susan Garcia'
sn-csm-server find-user --name 'Stephanie Todd'
sn-csm-server find-user-group --name 'CSM Tier 1 Support'
sn-csm-server list-group-members --user-id 6
sn-csm-server add-new-group-member --group-id 1 --user-id 6
sn-csm-server remove-group-membership --member-id 298
sn-csm-server remove-group-membership --member-id 659
sn-csm-server update-case --case-id 1 --priority critical --assignment-group-id 1 --assigned-to 6
sn-csm-server update-user-details --user-id 403 --active false
