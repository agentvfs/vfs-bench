#!/usr/bin/env bash
# A solution of task_20251207_174704_642_5c0cd3a2_c124578d, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --channel social --reopen-count 4
sn-csm-server find-products --product-id 195
sn-csm-server update-case --case-id 103 --priority high
sn-csm-server retrieve-knowledge --product-id 195 --limit 10
sn-csm-server find-case-knowledge-linkages --case-id 103
sn-csm-server find-user --name 'Amanda Austin'
sn-csm-server assign-case-to-user --case-id 103 --assigned-to-user-id 577
