#!/usr/bin/env bash
# A solution of task_20251206_091748_833_a8eea1c0_7775ff15, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000007
sn-csm-server find-contacts --contact-id 123
sn-csm-server find-user --name 'Curtis Mccoy'
sn-csm-server find-user-group --name 'Escalation Management'
sn-csm-server check-user-membership --user-id 177 --group-id 18
sn-csm-server update-case --case-id 7 --priority critical --escalation true --escalation-reason urgency
sn-csm-server update-case --case-id 7 --assignment-group-id 18 --assigned-to 177
sn-csm-server update-case --case-id 7 --state resolved
sn-csm-server find-case-slas --case-id 7
sn-csm-server update-case-sla-details --case-sla-id 13 --stage completed --has-breached false --completed-time '2025-09-01 00:00:00'
sn-csm-server update-case-sla-details --case-sla-id 14 --stage completed --has-breached false --completed-time '2025-09-01 00:00:00'
