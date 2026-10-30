#!/usr/bin/env bash
# A solution of task_20260102_155148_014_accab84d_910b176a, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Perry Watts'
sn-csm-server find-contact-by-portal-user --portal-user-id 727
sn-csm-server find-product --name 'Atlassian Jira Data Center'
sn-csm-server find-entitlements --account-id 30 --product-id 17 --active true
sn-csm-server create-new-case --account-id 30 --contact-id 64 --product-id 17 --channel email --priority high --state new --short-description 'Product: Atlassian Jira Data Center, Issue: is not working as expected and impacting delivery'
sn-csm-server retrieve-knowledge --search-text 'Atlassian Jira Data Center' --product-id 17 --state published --limit 5
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 27 --used-as suggested
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server find-sla-definitions --applies-to-priority high --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 2 --stage in_progress
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 7 --stage in_progress
