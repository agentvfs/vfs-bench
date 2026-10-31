#!/usr/bin/env bash
# A solution of task_20251204_231522_245_e6427839_5d09c3c2, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Initech
sn-csm-server find-product --name 'MySQL Enterprise 8.0 Variant 28'
sn-csm-server search-cases --account-id 5 --product-id 48
sn-csm-server find-entitlements --account-id 5 --active true
sn-csm-server find-case-slas --case-id 102
sn-csm-server update-case --case-id 102 --escalation true --escalation-reason customer_request
sn-csm-server find-contacts --account-id 5 --is-primary true
sn-csm-server list-users --user-id 63
sn-csm-server send-notification --case-id 102 --email thomas.bailey63@initech.io --type update
