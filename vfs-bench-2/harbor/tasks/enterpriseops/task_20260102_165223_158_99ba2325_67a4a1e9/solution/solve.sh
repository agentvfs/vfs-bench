#!/usr/bin/env bash
# A solution of task_20260102_165223_158_99ba2325_67a4a1e9, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Zebra Partners'
sn-csm-server find-contracts --account-id 2 --contract-type subscription
sn-csm-server update-contract --contract-id 3 --contract-price 25798
sn-csm-server find-contacts --account-id 2 --is-primary true
sn-csm-server list-users --user-id 802
sn-csm-server find-locations --location-id 802
sn-csm-server find-locations --street 'Janice Landing' --city tokyo --country japan
sn-csm-server update-user-details --user-id 802 --location-id 803
