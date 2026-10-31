#!/usr/bin/env bash
# A solution of task_20260102_080409_151_d4a463c3_56c32265, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000005
sn-csm-server find-case-slas --case-id 5
sn-csm-server find-case-knowledge-linkages --case-id 5
sn-csm-server retrieve-knowledge --knowledge-id 195
sn-csm-server update-case --case-id 5 --state resolved
sn-csm-server update-case-sla-details --case-sla-id 9 --stage completed --completed-time '2026-01-02 08:04:00'
sn-csm-server update-case-sla-details --case-sla-id 10 --stage completed --completed-time '2026-01-02 08:04:00'
sn-csm-server delete-case-knowledge-linkages --case-kb-id 1
sn-csm-server update-case --case-id 5 --state closed --closed-on '2026-01-02 08:04:00'
