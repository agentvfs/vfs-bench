#!/usr/bin/env bash
# A solution of task_20260108_160928_699_391f1eff_905701cb, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000058
sn-csm-server find-user --name 'Michael Ward'
sn-csm-server find-contacts --contact-id 1
sn-csm-server list-user-groups --group-id 5
sn-csm-server list-group-members --group-id 5
sn-csm-server find-user --name 'Gregory Richards'
sn-csm-server find-case-slas --case-id 58
sn-csm-server update-case --case-id 58 --state in_progress --priority critical --escalation true --escalation-reason customer_request --assigned-to 59
sn-csm-server update-case-sla-details --case-sla-id 115 --stage in_progress
sn-csm-server update-case-sla-details --case-sla-id 116 --stage in_progress
sn-csm-server register-new-interaction --channel email --account-id 3 --contact-id 1 --case-id 58 --interacted-user 47 --status open
sn-csm-server send-notification --case-id 58 --email michael.ward53@acme.com --type update
