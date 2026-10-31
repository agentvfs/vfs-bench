#!/usr/bin/env bash
# A solution of task_20260106_070321_497_accab84d_6f4a8da8, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Spencer Inc'
sn-csm-server find-contacts --account-id 18 --is-primary true
sn-csm-server list-users --user-id 16
sn-csm-server find-locations --location-id 16
sn-csm-server find-user --name 'Joanne Simpson'
sn-csm-server search-cases --account-id 18 --contact-id 30 --state new
sn-csm-server search-cases --account-id 18 --contact-id 30 --state in_progress
sn-csm-server search-cases --account-id 18 --contact-id 30 --state pending
sn-csm-server update-case --case-id 397 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 398 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 399 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 415 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 416 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 400 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 401 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 402 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 403 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 404 --priority critical --assigned-to 4
sn-csm-server update-case --case-id 405 --priority critical --assigned-to 4
