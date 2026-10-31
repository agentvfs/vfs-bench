#!/usr/bin/env bash
# A solution of task_20251204_160336_295_5c0cd3a2_26d1b04a, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Globex
sn-csm-server find-location --name 'Globex Hq - Sydney'
sn-csm-server find-installed-product-by-serial --serial-number P47-622334-4396
sn-csm-server find-contracts --account-id 4
sn-csm-server find-entitlements --account-id 4
sn-csm-server update-location --location-id 809 --name 'Globex HQ - Sydney' --plot-no 114B
sn-csm-server update-installed-product-details --installed-product-id 20 --status repair --warranty-end 2029-09-14
sn-csm-server update-entitlement --entitlement-id 31 --contract-id 10 --support-level premium --coverage-hours h24x7
sn-csm-server update-contract --contract-id 10 --end-date 2028-08-15
