#!/usr/bin/env bash
# A solution of task_20260107_164033_273_a8eea1c0_c0de2fed, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Globex
sn-csm-server retrieve-installed-products --account-id 4 --serial-number P152-537224-3992
sn-csm-server find-product --name 'Palo Alto Networks PA-3220 Variant 20'
sn-csm-server find-entitlements --account-id 4 --product-id 152 --active true
sn-csm-server update-installed-product-details --installed-product-id 21 --status retired
sn-csm-server register-new-installed-product --location-id 809 --account-id 4 --product-id 152 --serial-number P152-648335-99 --status in_use
sn-csm-server find-contacts --account-id 4 --is-primary true --active true
sn-csm-server find-user-by-email --email tabitha.bullock@servicenow.com
sn-csm-server create-new-case --account-id 4 --contact-id 2 --product-id 152 --installed-product-id 301 --channel web --priority moderate --state new --short-description 'Product: Palo Alto Networks PA-3220 Variant 20, Issue: unit P152-537224-3992 retired, replaced by P152-648335-99' --assigned-to 3
