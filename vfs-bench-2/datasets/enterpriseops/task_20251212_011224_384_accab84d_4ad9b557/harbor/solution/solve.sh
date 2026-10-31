#!/usr/bin/env bash
# A solution of task_20251212_011224_384_accab84d_4ad9b557, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Globex
sn-csm-server find-user --name 'Derek Blake'
sn-csm-server find-contacts --account-id 4
sn-csm-server update-contact --contact-id 2 --is-primary false
sn-csm-server update-contact --contact-id 3 --is-primary true --active true
sn-csm-server find-product --name 'HPE ProLiant DL380 Gen10'
sn-csm-server find-contracts --account-id 4 --status active
sn-csm-server find-entitlements --account-id 4 --active true
sn-csm-server create-new-case --account-id 4 --contact-id 3 --product-id 123 --channel email --priority moderate --state new --short-description 'Product: HPE ProLiant DL380 Gen10, Issue: is not working as expected.'
sn-csm-server retrieve-knowledge --product-id 123 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 189 --used-as suggested
sn-csm-server send-notification --case-id 1233 --knowledge-id 189 --email derek.blake7@globex.com --type solution_proposal
