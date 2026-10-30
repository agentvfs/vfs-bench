#!/usr/bin/env bash
# A solution of task_20260121_163208_054_1afb323a_7f40ee66, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Russell, Johnson and Clark'
sn-csm-server find-contracts --account-id 40 --contract-type support
sn-csm-server update-contract --contract-id 101 --contract-price 99108
sn-csm-server find-contacts --account-id 40 --is-primary true
sn-csm-server list-users --user-id 55
sn-csm-server find-location --name 'Smith Llc Hq - London'
sn-csm-server update-user-details --user-id 55 --location-id 903
