#!/usr/bin/env bash
# A solution of task_20260106_155841_121_e6427839_fa425cbe, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Avery Ltd'
sn-csm-server find-product --name 'VMware vSphere Enterprise Plus Variant 34'
sn-csm-server search-cases --account-id 44 --product-id 54 --state resolved
sn-csm-server find-entitlements --account-id 44 --active true
sn-csm-server retrieve-knowledge --search-text 'VMware vSphere Enterprise Plus' --state published --visibility external --limit 5
sn-csm-server find-contacts --contact-id 101
sn-csm-server list-users --user-id 21
sn-csm-server link-case-knowledge --case-id 1015 --knowledge-id 22 --used-as suggested
sn-csm-server send-notification --case-id 1015 --knowledge-id 22 --email andrew.bell58@averyltd.com --type solution_proposal
