#!/usr/bin/env bash
# A solution of task_20251128_204735_353_66392a82_3f8ef4a1, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Patricia Castro'
sn-csm-server find-account --name 'Carrillo Inc'
sn-csm-server find-contact-by-portal-user --portal-user-id 138
sn-csm-server find-installed-product-by-serial --serial-number P97-245230-8224
sn-csm-server find-entitlements --account-id 19 --product-id 97 --active true
sn-csm-server create-new-case --account-id 19 --contact-id 31 --product-id 97 --installed-product-id 98 --channel email --priority high --state new --short-description 'Product: Atlassian Jira Data Center Variant 77, Issue: is not working as expected.'
sn-csm-server find-sla-definitions --applies-to-priority high --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 2 --stage in_progress
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 7 --stage in_progress
sn-csm-server retrieve-knowledge --product-id 97 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 145 --used-as suggested
sn-csm-server send-notification --case-id 1233 --knowledge-id 145 --email patricia.castro@carrilloinc.com --type solution_proposal
