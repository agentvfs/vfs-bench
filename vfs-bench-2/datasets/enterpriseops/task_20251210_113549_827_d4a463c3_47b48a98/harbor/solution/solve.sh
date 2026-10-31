#!/usr/bin/env bash
# A solution of task_20251210_113549_827_d4a463c3_47b48a98, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Curtis Mccoy'
sn-csm-server list-group-members --user-id 177
sn-csm-server list-user-groups --group-id 18
sn-csm-server add-new-product --name 'Network Resilience Health Check' --category service --lifecycle-state active
sn-csm-server create-knowledge --title 'Network Resilience Health Check Troubleshooting' --body 'This kind of issues are tackled by Assignment Group: Escalation Management, Assigned to: Curtis Mccoy.' --state published --visibility internal --product-id 241 --owner-id 32
sn-csm-server find-account --name 'Stark, Petersen and Palmer'
sn-csm-server search-cases --number CS-0000888
sn-csm-server update-case --case-id 888 --state canceled
sn-csm-server find-contacts --account-id 38 --is-primary true
sn-csm-server find-entitlements --account-id 38 --active true
sn-csm-server create-new-case --account-id 38 --contact-id 84 --product-id 241 --channel phone --priority critical --state new --short-description 'Product: Network Resilience Health Check, Issue: operational instability.'
sn-csm-server update-case --case-id 1233 --assignment-group-id 18 --assigned-to 177 --escalation true --escalation-reason impact
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server find-sla-definitions --metric response --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 1 --stage in_progress
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 370 --used-as suggested
