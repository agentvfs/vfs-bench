#!/usr/bin/env bash
# A solution of task_20251205_153330_906_a8eea1c0_8c7a6205, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Marc Henry'
sn-csm-server find-contact-by-portal-user --portal-user-id 20
sn-csm-server find-product --name 'Palo Alto Networks PA-3220 Variant 8'
sn-csm-server retrieve-installed-products --account-id 8 --product-id 140
sn-csm-server find-entitlements --account-id 8 --product-id 140
sn-csm-server update-entitlement --entitlement-id 73 --support-level enterprise --coverage-hours h24x7 --max-cases-per-month 0
sn-csm-server find-user --name 'Curtis McCoy'
sn-csm-server find-user-group --name 'Escalation Management'
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 140 --installed-product-id 42 --channel phone --priority critical --state new --short-description 'Product: Palo Alto Networks PA-3220 Variant 8, Issue: Dataplane crashes repeatedly' --assignment-group-id 18 --assigned-to 177
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server find-sla-definitions --metric resolution --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 6 --stage in_progress --breach-time '2025-12-05 19:33:30' --has-breached false
