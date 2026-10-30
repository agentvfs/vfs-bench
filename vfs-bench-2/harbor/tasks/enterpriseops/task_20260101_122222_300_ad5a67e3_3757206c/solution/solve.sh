#!/usr/bin/env bash
# A solution of task_20260101_122222_300_ad5a67e3_3757206c, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Wayne Enterprises'
sn-csm-server find-contacts --account-id 7 --is-primary true
sn-csm-server update-contact --contact-id 9 --active true
sn-csm-server find-product --name 'Windows Server 2022 Datacenter'
sn-csm-server create-new-case --account-id 7 --contact-id 9 --product-id 1 --channel phone --priority high --state new --short-description 'SSL termination issue on Windows Server node'
sn-csm-server enlist-new-contract --account-id 7 --contract-type support --contract-price 150000 --status active --start-date 2026-01-01 --end-date 2026-12-31
sn-csm-server add-new-entitlement --account-id 7 --product-id 1 --contract-id 154 --support-level premium --coverage-hours h24x7 --max-cases-per-month 50 --active true
sn-csm-server find-sla-definitions --name 'SLA Response - High'
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 2 --stage in_progress
sn-csm-server update-case --case-id 1233 --state in_progress
