#!/usr/bin/env bash
# A solution of task_20260106_073527_320_e6427839_e2e2ac8d, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Cooper PLC'
sn-csm-server find-product --name 'Red Hat Enterprise Linux 9 Variant 63'
sn-csm-server search-cases --account-id 31 --product-id 83
sn-csm-server find-entitlements --account-id 31 --active true
sn-csm-server find-user-by-email --email daniel.hanson@servicenow.com
sn-csm-server find-user-group --name 'Returns Authorization Desk_3'
sn-csm-server check-user-membership --user-id 103 --group-id 55
sn-csm-server update-case --case-id 700 --escalation true --escalation-reason customer_request --assigned-to 103
