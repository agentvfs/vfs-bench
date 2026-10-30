#!/usr/bin/env bash
# A solution of task_20260121_145409_648_1afb323a_4e203caa, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Simon LLC'
sn-csm-server find-products --name 'NGINX Plus'
sn-csm-server find-product --name 'NGINX Plus Variant 11'
sn-csm-server enlist-new-contract --account-id 45 --contract-type support --contract-price 72000 --status active --start-date 2025-11-15 --end-date 2026-11-15
sn-csm-server add-new-entitlement --account-id 45 --product-id 31 --contract-id 154 --support-level premium --coverage-hours h24x7 --max-cases-per-month 15 --active true
sn-csm-server add-new-sla-definition --name 'SLA Response - High (Simon LLC NGINX Plus)' --metric response --target-mins 45 --pause-on-pending true --applies-to-priority high --active true
sn-csm-server add-new-sla-definition --name 'SLA Resolution - High (Simon LLC NGINX Plus)' --metric resolution --target-mins 240 --pause-on-pending true --applies-to-priority high --active true
