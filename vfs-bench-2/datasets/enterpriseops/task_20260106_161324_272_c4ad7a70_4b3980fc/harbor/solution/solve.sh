#!/usr/bin/env bash
# A solution of task_20260106_161324_272_c4ad7a70_4b3980fc, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Acme Systems'
sn-csm-server find-user --name 'Michael Ward'
sn-csm-server find-contact-by-portal-user --portal-user-id 47
sn-csm-server find-product --name 'SUSE Linux Enterprise Server 15 Variant 5'
sn-csm-server search-cases --account-id 3 --product-id 25 --state new
sn-csm-server find-user-by-email --email tabitha.bullock@servicenow.com
sn-csm-server list-user-groups --group-id 30
sn-csm-server check-user-membership --user-id 3 --group-id 30
sn-csm-server add-new-group-member --group-id 30 --user-id 3
sn-csm-server update-case --case-id 71 --escalation true --escalation-reason vip --assigned-to 3
