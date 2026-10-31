#!/usr/bin/env bash
# A solution of task_20251203_194626_202_391f1eff_1336fae8, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user-group --name 'Installed Base Support'
sn-csm-server search-cases --number CS-0001179
sn-csm-server find-case-slas --case-id 1179
sn-csm-server find-case-knowledge-linkages --case-id 1179
sn-csm-server retrieve-knowledge --product-id 137 --state published
sn-csm-server update-case --case-id 1179 --state in_progress --escalation true --escalation-reason customer_request
sn-csm-server update-case-sla-details --case-sla-id 2358 --stage in_progress
sn-csm-server link-case-knowledge --case-id 1179 --knowledge-id 206 --used-as suggested
