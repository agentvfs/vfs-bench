#!/usr/bin/env bash
# A solution of task_20260106_075904_098_a8eea1c0_a6cfe625, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Stark Industries'
sn-csm-server find-product --name 'Palo Alto Networks PA-3220 Variant 8'
sn-csm-server retrieve-installed-products --account-id 8 --product-id 140
sn-csm-server search-cases --account-id 8 --installed-product-id 42 --state new
sn-csm-server find-entitlements --account-id 8 --product-id 140 --active true
sn-csm-server update-case --case-id 181 --priority critical --state in_progress --escalation true --escalation-reason vip
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 181 --sla-def-id 1 --stage in_progress
sn-csm-server link-new-case-sla --case-id 181 --sla-def-id 6 --stage in_progress
sn-csm-server find-user --name 'Curtis Mccoy'
sn-csm-server find-user-group --name 'Escalation Management'
sn-csm-server check-user-membership --user-id 177 --group-id 18
sn-csm-server set-case-assignment-group --case-id 181 --assignment-group-id 18
sn-csm-server assign-case-to-user --case-id 181 --assigned-to-user-id 177
sn-csm-server find-user --name 'Marc Henry'
sn-csm-server find-contacts --account-id 8
sn-csm-server retrieve-knowledge --kb-number KB-0000103
sn-csm-server update-knowledge --knowledge-id 103 --state retired --visibility internal
