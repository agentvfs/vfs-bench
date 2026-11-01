#!/usr/bin/env bash
# A solution of task_20251212_081413_439_66392a82_7eb34f57, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000026
sn-csm-server retrieve-knowledge --product-id 67
sn-csm-server update-knowledge --knowledge-id 101 --state published
sn-csm-server link-case-knowledge --case-id 26 --knowledge-id 101 --used-as applied
sn-csm-server find-user --name 'Randy Martinez'
sn-csm-server find-user-group --name 'Knowledge Curation'
sn-csm-server check-user-membership --user-id 37 --group-id 13
sn-csm-server add-new-group-member --group-id 13 --user-id 37
sn-csm-server update-case --case-id 26 --assignment-group-id 13 --assigned-to 37 --state in_progress
