#!/usr/bin/env bash
# A solution of task_20251210_002938_761_897c3e0b_f075229a, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Klein, Black and Wood'
sn-csm-server find-locations --country india
sn-csm-server retrieve-installed-products --account-id 52 --location-id 906
sn-csm-server find-product-by-id --product-id 133
sn-csm-server find-contacts --account-id 52 --is-primary true
sn-csm-server list-user-groups --name 'Installed Base Support'
sn-csm-server find-sla-definitions --metric response --applies-to-priority moderate --active true
sn-csm-server create-new-case --account-id 52 --contact-id 120 --product-id 133 --installed-product-id 295 --channel community --priority moderate --state new --short-description 'Product: Dell PowerEdge R740 (Config 1), Issue: is not working as expected.' --assignment-group-id 10
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 3 --stage in_progress
