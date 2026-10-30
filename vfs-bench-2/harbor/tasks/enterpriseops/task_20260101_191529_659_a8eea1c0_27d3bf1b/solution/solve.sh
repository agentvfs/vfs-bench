#!/usr/bin/env bash
# A solution of task_20260101_191529_659_a8eea1c0_27d3bf1b, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Acme Systems'
sn-csm-server find-product --name 'MySQL Enterprise 8.0 Variant 28'
sn-csm-server retrieve-installed-products --account-id 3 --product-id 48
sn-csm-server find-contacts --account-id 3 --is-primary true
sn-csm-server find-entitlements --account-id 3 --active true
sn-csm-server find-user-group --name 'CSM Tier 1 Support'
sn-csm-server find-user --name 'Stephanie Todd'
sn-csm-server create-new-case --account-id 3 --contact-id 1 --product-id 48 --installed-product-id 14 --channel alert --priority critical --state new --short-description 'Product: MySQL Enterprise 8.0 Variant 28, Issue: is not working as expected.'
sn-csm-server register-new-interaction --channel alert --account-id 3 --contact-id 1 --case-id 1233 --status open
sn-csm-server set-case-assignment-group --case-id 1233 --assignment-group-id 1
sn-csm-server check-user-membership --user-id 6 --group-id 1
sn-csm-server add-new-group-member --group-id 1 --user-id 6
sn-csm-server assign-case-to-user --case-id 1233 --assigned-to-user-id 6
sn-csm-server update-installed-product-details --installed-product-id 14 --status repair
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server find-sla-definitions --metric resolution --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 6 --stage in_progress
