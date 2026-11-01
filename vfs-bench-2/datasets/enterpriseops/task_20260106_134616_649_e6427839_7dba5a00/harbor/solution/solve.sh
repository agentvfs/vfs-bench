#!/usr/bin/env bash
# A solution of task_20260106_134616_649_e6427839_7dba5a00, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Simon LLC'
sn-csm-server search-cases --number CS-0001041
sn-csm-server find-entitlements --account-id 45 --active true
sn-csm-server find-case-slas --case-id 1041
sn-csm-server find-user --name 'David Johnston'
sn-csm-server check-user-membership --user-id 72 --group-id 40
sn-csm-server retrieve-knowledge --product-id 113 --state published
sn-csm-server update-case --case-id 1041 --priority critical --assigned-to 72
sn-csm-server link-case-knowledge --case-id 1041 --knowledge-id 174 --used-as suggested
