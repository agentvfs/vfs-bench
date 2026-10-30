#!/usr/bin/env bash
# A solution of task_20260101_074825_586_a8eea1c0_e596bab2, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Stark Industries'
sn-csm-server find-contacts --account-id 8
sn-csm-server retrieve-installed-products --account-id 8 --product-id 140
sn-csm-server search-cases --account-id 8 --product-id 140
sn-csm-server find-contracts --account-id 8 --status active
sn-csm-server find-entitlements --account-id 8 --active true
sn-csm-server find-user-group --name 'Installed Base Support'
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server update-installed-product-details --installed-product-id 42 --status repair
sn-csm-server register-new-installed-product --account-id 8 --product-id 140 --location-id 817 --serial-number RMA-STARK-001 --status in_use
sn-csm-server update-case --case-id 181 --priority critical --escalation true --escalation-reason impact --installed-product-id 301 --assignment-group-id 10 --state in_progress
sn-csm-server link-new-case-sla --case-id 181 --sla-def-id 6 --stage in_progress --has-breached false
sn-csm-server send-notification --case-id 181 --email marc.henry@stark-industries.com --type update
