#!/usr/bin/env bash
# A solution of task_20260106_145907_700_a8eea1c0_f5bae698, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Thomas Green'
sn-csm-server update-user-details --user-id 1 --active true
sn-csm-server add-new-product --name 'Integrated Security Policy Audit' --category service --lifecycle-state active
sn-csm-server create-knowledge --title 'Issue Resolution related to Integrated Security Policy Audit, step-by-step guide' --state published --visibility internal --product-id 241 --owner-id 1 --body 'Tackled by Assignment Group: CSM Tier 2 Support, Assigned to: Thomas Green. Steps: validate audit data integrity.'
sn-csm-server find-account --name 'Stark Industries'
sn-csm-server search-cases --number CS-0000197
sn-csm-server update-case --case-id 197 --state canceled
sn-csm-server find-user --name 'Marc Henry'
sn-csm-server find-contacts --account-id 8 --portal-user-id 20
sn-csm-server find-entitlements --account-id 8 --product-id 241 --active true
sn-csm-server find-entitlements --account-id 8 --active true
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 241 --channel phone --priority critical --state new --short-description 'Product: Integrated Security Policy Audit, Issue: data integrity failures.'
sn-csm-server find-user-group --name 'CSM Tier 2 Support'
sn-csm-server set-case-assignment-group --case-id 1233 --assignment-group-id 2
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 370 --used-as suggested
sn-csm-server find-sla-definitions --metric response --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 1 --stage in_progress
sn-csm-server update-case --case-id 1233 --state in_progress --priority critical --escalation true --escalation-reason impact
