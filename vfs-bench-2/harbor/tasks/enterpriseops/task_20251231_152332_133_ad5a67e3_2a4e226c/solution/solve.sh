#!/usr/bin/env bash
# A solution of task_20251231_152332_133_ad5a67e3_2a4e226c, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Ryan Allen'
sn-csm-server get-cases-assigned-to --assigned-to 62
sn-csm-server find-case-knowledge-linkages --case-id 5
sn-csm-server retrieve-knowledge --knowledge-id 195
sn-csm-server update-knowledge --knowledge-id 195 --state published
sn-csm-server link-case-knowledge --case-id 5 --knowledge-id 195 --used-as applied
