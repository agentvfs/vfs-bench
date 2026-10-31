#!/usr/bin/env bash
# A solution of task_20251201_164641_724_109c89c0_1b29acb9, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Globex
sn-csm-server find-contacts --account-id 4
sn-csm-server list-users --user-id 347
sn-csm-server list-users --user-id 622
sn-csm-server list-users --user-id 455
sn-csm-server search-cases --account-id 4 --contact-id 2
sn-csm-server update-case --case-id 77 --contact-id 3
sn-csm-server update-case --case-id 78 --contact-id 3
sn-csm-server update-case --case-id 82 --contact-id 3
sn-csm-server update-case --case-id 83 --contact-id 3
sn-csm-server update-case --case-id 93 --contact-id 3
sn-csm-server update-case --case-id 97 --contact-id 3
sn-csm-server update-case --case-id 98 --contact-id 3
sn-csm-server update-contact --contact-id 3 --is-primary true
sn-csm-server update-contact --contact-id 2 --is-primary false --active false
sn-csm-server update-user-details --user-id 347 --active false
sn-csm-server create-new-case --account-id 4 --contact-id 3 --channel web --priority moderate --state new --short-description 'Globex primary contact handover: Joshua Morgan replaced by Derek Blake, open cases moved'
sn-csm-server send-notification --case-id 1233 --email derek.blake7@globex.com --type update
