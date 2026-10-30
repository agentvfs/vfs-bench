#!/usr/bin/env bash
# A solution of task_20251231_162628_797_a8eea1c0_0a53db6c, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Stark Industries'
sn-csm-server retrieve-installed-products --account-id 8
sn-csm-server find-product-by-id --product-id 140
sn-csm-server find-entitlements --account-id 8 --product-id 140
sn-csm-server find-contacts --account-id 8 --is-primary true
sn-csm-server enlist-new-contract --account-id 8 --contract-type support --status active --start-date 2025-11-18 --end-date 2026-11-18
sn-csm-server add-new-entitlement --account-id 8 --product-id 140 --contract-id 154 --support-level enterprise --coverage-hours h24x7 --active true
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 140 --installed-product-id 42 --channel web --priority critical --state new --short-description 'Product: Palo Alto Networks PA-3220 Variant 8, Issue: repeated dataplane crashes causing outage.'
sn-csm-server find-user-group --name 'Escalation Management'
sn-csm-server set-case-assignment-group --case-id 1233 --assignment-group-id 18
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server find-sla-definitions --metric resolution --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 6 --stage in_progress
sn-csm-server retrieve-knowledge --product-id 140 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 210 --used-as suggested
