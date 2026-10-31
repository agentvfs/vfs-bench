#!/usr/bin/env bash
# A solution of task_20260106_185201_238_00364ece_8ab4fd80, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Marc Henry'
sn-csm-server find-contact-by-portal-user --portal-user-id 20
sn-csm-server find-product --name 'SUSE Linux Enterprise Server 15 Variant 5'
sn-csm-server find-entitlements --account-id 8 --product-id 25 --active true
sn-csm-server find-user --name 'Tabitha Bullock'
sn-csm-server find-user-group --name 'Proactive Case Monitoring'
sn-csm-server check-user-membership --user-id 3 --group-id 11
sn-csm-server add-new-group-member --group-id 11 --user-id 3
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 25 --channel email --priority high --state new --short-description 'Product: SUSE Linux Enterprise Server 15 Variant 5, Issue: not stable after configuration changes' --assignment-group-id 11 --assigned-to 3
sn-csm-server retrieve-knowledge --search-text 'SUSE Linux Enterprise Server 15 Variant 5 not stable after configuration changes' --product-id 25 --state published --limit 5
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 38 --used-as suggested
sn-csm-server send-notification --case-id 1233 --email marc.henry@stark-industries.com --type report
