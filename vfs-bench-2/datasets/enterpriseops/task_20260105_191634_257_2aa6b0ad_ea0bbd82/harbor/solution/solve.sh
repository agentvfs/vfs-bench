#!/usr/bin/env bash
# A solution of task_20260105_191634_257_2aa6b0ad_ea0bbd82, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000280
sn-csm-server find-user --name 'Tim Anderson'
sn-csm-server find-user --name 'William Wyatt'
sn-csm-server get-cases-assigned-to --assigned-to 606
sn-csm-server get-cases-assigned-to --assigned-to 645
sn-csm-server find-user-group --name 'Field Service Coordination'
sn-csm-server find-user-group --name 'Proactive Case Monitoring'
sn-csm-server check-user-membership --user-id 645 --group-id 11
sn-csm-server add-new-group-member --group-id 11 --user-id 645
sn-csm-server update-case --case-id 280 --assignment-group-id 11 --assigned-to 645
sn-csm-server find-contacts --contact-id 19
sn-csm-server list-users --user-id 428
sn-csm-server send-notification --case-id 280 --email alexandra.wright@millermonroeandarroyo.com --type reminder
