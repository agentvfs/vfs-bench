#!/usr/bin/env bash
# A solution of task_20260106_192119_816_ad5a67e3_87a5a87c, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server get-accounts --name 'Acme Systems'
sn-csm-server search-cases --account-id 3 --priority critical --state new
sn-csm-server list-user-groups --name 'Case Triage'
sn-csm-server count-case-by-state --assignment-group-id 3
sn-csm-server find-entitlements --account-id 3 --product-id 159 --active true --support-level enterprise
sn-csm-server update-case --case-id 53 --assignment-group-id 3 --state in_progress
