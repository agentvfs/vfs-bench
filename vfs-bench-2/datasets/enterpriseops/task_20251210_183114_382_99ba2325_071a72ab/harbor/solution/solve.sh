#!/usr/bin/env bash
# A solution of task_20251210_183114_382_99ba2325_071a72ab, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000944
sn-csm-server find-case-knowledge-linkages --case-id 944
sn-csm-server find-case-slas --case-id 944
sn-csm-server find-user --name 'Jason Morrison'
sn-csm-server create-knowledge --title 'Thomas Group issue' --state published --visibility internal --owner-id 84 --body 'This issue is not related to any ServiceNow product directly, it occurred due to dependency on other products.'
sn-csm-server link-case-knowledge --case-id 944 --knowledge-id 370 --used-as resolution
sn-csm-server update-case --case-id 944 --state closed
