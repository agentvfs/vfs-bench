#!/usr/bin/env bash
# A solution of task_20251202_100743_745_109c89c0_958a07c1, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Acme Systems'
sn-csm-server retrieve-installed-products --account-id 3
sn-csm-server find-entitlements --account-id 3
sn-csm-server find-contracts --account-id 3
sn-csm-server search-cases --account-id 3 --product-id 25
sn-csm-server search-cases --account-id 3 --product-id 159
sn-csm-server update-contract --contract-id 133 --status active --end-date 2029-07-07
sn-csm-server update-entitlement --entitlement-id 26 --active true
sn-csm-server update-entitlement --entitlement-id 27 --active true
