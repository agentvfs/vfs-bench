#!/usr/bin/env bash
# A solution of task_20260101_111750_695_30600918_80637585, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000020
sn-csm-server list-group-members --user-id 4
sn-csm-server list-user-groups --group-id 1
sn-csm-server list-user-groups --group-id 66
sn-csm-server update-case --case-id 20 --state in_progress --priority critical --escalation true --escalation-reason customer_request --assignment-group-id 1
sn-csm-server find-case-slas --case-id 20
sn-csm-server update-case-sla-details --case-sla-id 39 --stage canceled
sn-csm-server update-case-sla-details --case-sla-id 40 --stage canceled
sn-csm-server find-sla-definitions --applies-to-priority critical --active true
sn-csm-server link-new-case-sla --case-id 20 --sla-def-id 1 --stage in_progress
sn-csm-server link-new-case-sla --case-id 20 --sla-def-id 6 --stage in_progress
sn-csm-server send-notification --case-id 20 --email joanne.simpson@servicenow.com --type update
