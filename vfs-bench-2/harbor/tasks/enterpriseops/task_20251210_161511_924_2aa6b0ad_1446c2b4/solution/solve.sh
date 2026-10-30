#!/usr/bin/env bash
# A solution of task_20251210_161511_924_2aa6b0ad_1446c2b4, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Jermaine Hall'
sn-csm-server find-contact-by-portal-user --portal-user-id 752
sn-csm-server search-cases --contact-id 14 --state in_progress
sn-csm-server find-user --name 'Paul Moyer'
sn-csm-server find-user-group --name 'Case Triage_4'
sn-csm-server check-user-membership --user-id 619 --group-id 63
sn-csm-server add-new-group-member --group-id 63 --user-id 619
sn-csm-server update-case --case-id 231 --assignment-group-id 63 --assigned-to 619
sn-csm-server send-notification --case-id 231 --email jermaine.hall@hooli.com --type report
