#!/usr/bin/env bash
# A solution of task_20251125_152842_063_b393a327_9622ac64, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-product --name 'NGINX Plus'
sn-csm-server create-new-account --name 'Apex Industries' --email-domain apex-ind.com --account-type customer --active true
sn-csm-server add-new-user --first-name Sarah --last-name Miles --email sarah@apex-ind.com --role customer --active true
sn-csm-server create-contact --account-id 53 --portal-user-id 803 --active true --is-primary true
sn-csm-server register-new-installed-product --account-id 53 --product-id 11 --serial-number APX-NGINX-001 --status in_use
sn-csm-server enlist-new-contract --account-id 53 --contract-type support --contract-price 35000 --status active --start-date 2025-11-18 --end-date 2026-11-18
sn-csm-server add-new-entitlement --account-id 53 --product-id 11 --contract-id 154 --support-level premium --coverage-hours h24x7 --max-cases-per-month 40 --active true
sn-csm-server create-new-case --account-id 53 --contact-id 125 --product-id 11 --installed-product-id 301 --channel phone --priority high --state new --short-description 'NGINX Plus returning 502 Bad Gateway since go-live'
