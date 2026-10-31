#!/usr/bin/env bash
# A solution of task_20251206_114027_879_5c0cd3a2_904991cc, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000009
sn-csm-server list-users --email anthony.peterson@servicenow.com
sn-csm-server find-product-by-id --product-id 163
sn-csm-server retrieve-knowledge --product-id 163 --state published
sn-csm-server find-case-knowledge-linkages --case-id 9
sn-csm-server update-case --case-id 9 --state in_progress
sn-csm-server link-case-knowledge --case-id 9 --knowledge-id 243 --used-as applied
