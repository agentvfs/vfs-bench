#!/usr/bin/env bash
# A solution of task_20260106_151754_319_d4a463c3_41f0af13, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server retrieve-installed-products --status in_use
sn-csm-server search-cases --installed-product-id 42
sn-csm-server search-cases --installed-product-id 113
sn-csm-server search-cases --installed-product-id 182
sn-csm-server search-cases --installed-product-id 243
sn-csm-server find-product-by-id --product-id 140
sn-csm-server find-contracts --account-id 33
sn-csm-server find-entitlements --account-id 33 --product-id 140
sn-csm-server register-new-installed-product --account-id 33 --product-id 140 --location-id 867 --serial-number P140-411674-6934-R --status in_use --warranty-end 2027-09-16
sn-csm-server update-installed-product-details --installed-product-id 182 --status retired
sn-csm-server update-case --case-id 747 --installed-product-id 301
sn-csm-server update-case --case-id 768 --installed-product-id 301
sn-csm-server update-case --case-id 769 --installed-product-id 301
sn-csm-server find-contacts --account-id 33 --is-primary true
sn-csm-server list-users --user-id 19
sn-csm-server send-notification --case-id 747 --email angela.brooks@phillips-jones.com --type update
sn-csm-server send-notification --case-id 768 --email angela.brooks@phillips-jones.com --type update
sn-csm-server send-notification --case-id 769 --email angela.brooks@phillips-jones.com --type update
