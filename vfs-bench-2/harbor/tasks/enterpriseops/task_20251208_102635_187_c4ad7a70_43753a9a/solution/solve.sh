#!/usr/bin/env bash
# A solution of task_20251208_102635_187_c4ad7a70_43753a9a, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Ramos-Case
sn-csm-server find-user --name 'Natalie Sanders'
sn-csm-server find-contacts --account-id 26
sn-csm-server update-contact --contact-id 50 --is-primary false
sn-csm-server update-contact --contact-id 51 --is-primary true
sn-csm-server find-product --name 'Pure Storage FlashArray//X Variant 47'
sn-csm-server retrieve-installed-products --account-id 26 --product-id 179
sn-csm-server create-new-case --account-id 26 --contact-id 51 --product-id 179 --installed-product-id 139 --channel alert --priority moderate --state new --short-description 'Product: Pure Storage FlashArray//X Variant 47, Issue: unusually high hardware temperatures reported.'
