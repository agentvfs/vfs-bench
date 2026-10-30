#!/usr/bin/env bash
# A solution of task_20260107_111503_670_2aa6b0ad_e9611a77, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Thomas Martin'
sn-csm-server find-account --name Morse-Gomez
sn-csm-server find-contacts --account-id 21
sn-csm-server find-installed-product-by-serial --serial-number P164-989725-4840
sn-csm-server find-product-by-id --product-id 164
sn-csm-server find-entitlements --account-id 21 --active true
sn-csm-server search-cases --account-id 21 --product-id 164 --state pending
sn-csm-server create-contact --account-id 21 --portal-user-id 784 --active true --is-primary false
sn-csm-server create-new-case --account-id 21 --contact-id 125 --product-id 164 --channel email --priority critical --state new --short-description 'Product: Palo Alto Networks PA-3220 Variant 32, Issue: device needs repair, hampering business.'
sn-csm-server retrieve-knowledge --product-id 164 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 244 --used-as suggested
sn-csm-server update-case --case-id 463 --state canceled
