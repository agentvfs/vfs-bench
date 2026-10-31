#!/usr/bin/env bash
# A solution of task_20251205_101915_742_d4a463c3_8eac8077, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000005
sn-csm-server find-product --name 'Palo Alto Networks PA-3220'
sn-csm-server list-users --email jose.roberson@servicenow.com
sn-csm-server find-contacts --account-id 1
sn-csm-server list-users --user-id 801
sn-csm-server list-users --user-id 62
sn-csm-server update-case --case-id 5 --state resolved
sn-csm-server create-knowledge --title 'Restore PA-3220 connection queue and restart monitoring service' --state published --visibility external --product-id 128 --owner-id 32 --body 'Handled by Escalation Management, Ryan Allen. Steps: restore PA-3220 connection queue, restart monitoring service.'
sn-csm-server link-case-knowledge --case-id 5 --knowledge-id 370 --used-as resolution
sn-csm-server register-new-interaction --channel email --account-id 1 --contact-id 123 --case-id 5 --interacted-user 32 --status handled
sn-csm-server send-notification --case-id 5 --knowledge-id 370 --email elizabeth.chase32@servicenow.com --type solution_proposal
sn-csm-server search-cases --account-id 1 --state resolved
sn-csm-server find-interactions --account-id 1
sn-csm-server link-case-knowledge --case-id 10 --knowledge-id 370 --used-as resolution
sn-csm-server update-case --case-id 10 --state closed
