#!/usr/bin/env bash
# A solution of task_20260102_063731_186_d4a463c3_f1c4df9b, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server list-users --email kathy.oliver@thomasgroup.com
sn-csm-server find-contacts --portal-user-id 238
sn-csm-server find-products --name 'Tomcat 9 Variant 32'
sn-csm-server search-cases --contact-id 120 --product-id 52
sn-csm-server find-case-knowledge-linkages --case-id 1204
sn-csm-server retrieve-knowledge --knowledge-id 77
sn-csm-server delete-case-knowledge-linkages --case-kb-id 515
sn-csm-server update-case --case-id 1204 --escalation true --escalation-reason impact
sn-csm-server register-new-interaction --channel email --account-id 52 --contact-id 120 --case-id 1204 --interacted-user 238 --status handled
