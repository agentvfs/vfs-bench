#!/usr/bin/env bash
# A solution of task_20251205_135905_848_391f1eff_9344499e, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000379
sn-csm-server find-user-group --name 'Contact Center L2'
sn-csm-server find-user-by-email --email lisa.brown@servicenow.com
sn-csm-server check-user-membership --user-id 656 --group-id 9
sn-csm-server assign-case-to-user --case-id 379 --assigned-to-user-id 656
sn-csm-server update-case --case-id 379 --state in_progress
sn-csm-server find-case-slas --case-id 379
sn-csm-server update-case-sla-details --case-sla-id 757 --stage in_progress
sn-csm-server retrieve-knowledge --product-id 38 --state published
sn-csm-server link-case-knowledge --case-id 379 --knowledge-id 57 --used-as suggested
