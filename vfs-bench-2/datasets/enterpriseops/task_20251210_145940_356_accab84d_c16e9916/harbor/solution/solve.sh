#!/usr/bin/env bash
# A solution of task_20251210_145940_356_accab84d_c16e9916, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Elizabeth Chase'
sn-csm-server find-account --name ServiceNow
sn-csm-server find-contact-by-portal-user --portal-user-id 801
sn-csm-server find-product --name 'Palo Alto Networks PA-3220'
sn-csm-server search-cases --account-id 1 --contact-id 123 --product-id 128 --priority moderate
sn-csm-server find-entitlements --account-id 1 --active true
sn-csm-server update-case --case-id 5 --priority critical --escalation true --escalation-reason impact --short-description 'Product: Palo Alto Networks PA-3220, Issue: Major packet drops affecting production - significantly worsened'
sn-csm-server find-case-slas --case-id 5
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 5 --sla-def-id 1 --stage in_progress
sn-csm-server link-new-case-sla --case-id 5 --sla-def-id 6 --stage in_progress
sn-csm-server retrieve-knowledge --search-text 'Palo Alto Networks PA-3220 Packet Drop Troubleshooting' --state published --visibility external --limit 3
sn-csm-server link-case-knowledge --case-id 5 --knowledge-id 227 --used-as suggested
sn-csm-server send-notification --case-id 5 --knowledge-id 227 --email elizabeth.chase32@servicenow.com --type update
