#!/usr/bin/env bash
# A solution of task_20260101_043715_660_a8eea1c0_7304e48e, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Stark Industries'
sn-csm-server find-user --name 'Marc Henry'
sn-csm-server find-contacts --account-id 8 --portal-user-id 20
sn-csm-server find-product --name 'Juniper EX4300 Variant 7'
sn-csm-server find-entitlements --account-id 8
sn-csm-server add-location --name 'Stark Industries - New Lab' --active true --city london --country uk
sn-csm-server register-new-installed-product --location-id 907 --account-id 8 --product-id 139 --serial-number JEX-987654-NL --status in_use
sn-csm-server enlist-new-contract --account-id 8 --contract-type support --status active --start-date 2025-11-27 --end-date 2026-11-27
sn-csm-server add-new-entitlement --account-id 8 --product-id 139 --contract-id 154 --support-level enterprise --coverage-hours h24x7 --max-cases-per-month 0 --active true
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 139 --installed-product-id 301 --channel phone --priority critical --state new --short-description 'Product: Juniper EX4300 Variant 7, Issue: critical failure at the new London Lab'
sn-csm-server find-user-group --name 'CSM Tier 2 Support'
sn-csm-server list-group-members --group-id 2
sn-csm-server update-case --case-id 1233 --assignment-group-id 2 --assigned-to 127 --state in_progress
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 1 --stage in_progress
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 6 --stage in_progress
sn-csm-server retrieve-knowledge --product-id 139 --state published --limit 5
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 209 --used-as suggested
sn-csm-server send-notification --case-id 1233 --knowledge-id 209 --email marc.henry@stark-industries.com --type solution_proposal
