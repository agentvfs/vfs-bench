#!/usr/bin/env bash
# A solution of task_20260102_002012_363_00364ece_a3936446, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Stephanie Clark'
sn-csm-server find-contact-by-portal-user --portal-user-id 322
sn-csm-server find-product --name 'Docker Enterprise Variant 35'
sn-csm-server find-entitlements --account-id 29 --active true
sn-csm-server find-user --name 'Mario Perry'
sn-csm-server update-user-details --user-id 532 --active false
sn-csm-server find-user --name 'Emily Moore'
sn-csm-server find-user-group --name 'Field Service Coordination_2'
sn-csm-server check-user-membership --user-id 701 --group-id 34
sn-csm-server add-new-group-member --group-id 34 --user-id 701
sn-csm-server create-new-case --account-id 29 --contact-id 61 --product-id 55 --channel email --priority high --state new --short-description 'Product: Docker Enterprise Variant 35, Issue: older bugs affecting stable branches' --assignment-group-id 34 --assigned-to 701
sn-csm-server retrieve-knowledge --product-id 55 --state published --limit 5
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 81 --used-as suggested
sn-csm-server send-notification --case-id 1233 --knowledge-id 81 --email stephanie.clark4@jonesgoodmanandreynolds.com --type report
