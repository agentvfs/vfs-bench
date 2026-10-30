#!/usr/bin/env bash
# A solution of task_20260102_162857_012_391f1eff_39478d55, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Marc Henry'
sn-csm-server find-contact-by-portal-user --portal-user-id 20
sn-csm-server find-product --name 'SUSE Linux Enterprise Server 15 Variant 5'
sn-csm-server find-entitlements --account-id 8 --product-id 25 --active true
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 25 --channel web --priority moderate --state new --short-description 'Product: SUSE Linux Enterprise Server 15 Variant 5, Issue: is not working as expected.'
sn-csm-server retrieve-knowledge --product-id 25 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 38 --used-as suggested
