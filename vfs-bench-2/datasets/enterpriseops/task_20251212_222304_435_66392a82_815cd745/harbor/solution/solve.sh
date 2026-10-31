#!/usr/bin/env bash
# A solution of task_20251212_222304_435_66392a82_815cd745, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Tabitha Bullock'
sn-csm-server get-cases-assigned-to --assigned-to 3
sn-csm-server find-user --name 'Lisa Smith'
sn-csm-server find-user-group --name 'Case Assignment_3'
sn-csm-server check-user-membership --user-id 496 --group-id 44
sn-csm-server add-new-group-member --group-id 44 --user-id 496
sn-csm-server update-case --case-id 251 --assignment-group-id 44 --assigned-to 496
sn-csm-server update-case --case-id 1142 --assignment-group-id 44 --assigned-to 496
sn-csm-server update-user-details --user-id 3 --active false
sn-csm-server find-contacts --contact-id 15
sn-csm-server list-users --user-id 10
sn-csm-server send-notification --case-id 251 --email brandon.davis@vehementcap.com --type report
sn-csm-server find-contacts --contact-id 112
sn-csm-server list-users --user-id 340
sn-csm-server send-notification --case-id 1142 --email david.trujillo@hernandezbarnettandstewart.com --type report
