#!/usr/bin/env bash
# A solution of task_20251208_123126_960_c4ad7a70_f974dae7, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Andrew Bell'
sn-csm-server find-account --name 'Avery Ltd'
sn-csm-server find-contacts --account-id 44 --portal-user-id 21
sn-csm-server find-product --name 'Palo Alto Networks PA-3220 Variant 8'
sn-csm-server retrieve-installed-products --account-id 44 --product-id 140
sn-csm-server create-new-case --account-id 44 --contact-id 101 --product-id 140 --installed-product-id 243 --channel social --priority moderate --state new --short-description 'Product: Palo Alto Networks PA-3220 Variant 8, Issue: unusually high operating noise'
sn-csm-server register-new-interaction --channel social --account-id 44 --contact-id 101 --case-id 1233 --interacted-user 21 --status handled
