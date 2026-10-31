#!/usr/bin/env bash
# A solution of task_20251205_095558_939_5c0cd3a2_4af4214c, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Allen Martin'
sn-csm-server find-contact-by-portal-user --portal-user-id 189
sn-csm-server find-locations --city sydney
sn-csm-server retrieve-installed-products --account-id 9
sn-csm-server find-product-by-id --product-id 155
sn-csm-server find-user --name 'Joseph Johnson'
sn-csm-server find-contact-by-portal-user --portal-user-id 610
sn-csm-server create-contact --account-id 9 --portal-user-id 610 --active true --is-primary false
sn-csm-server create-new-case --account-id 9 --contact-id 125 --product-id 155 --installed-product-id 48 --channel web --priority critical --state new --short-description 'Product: Pure Storage FlashArray//X Variant 23, Issue: is not working as expected.'
