#!/usr/bin/env bash
# A solution of task_20260107_162554_472_accab84d_41d2e871, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'David Ramirez'
sn-csm-server find-contact-by-portal-user --portal-user-id 18
sn-csm-server find-product --name 'Tomcat 9 Variant 12'
sn-csm-server retrieve-installed-products --account-id 25 --product-id 32
sn-csm-server find-entitlements --account-id 25 --active true
sn-csm-server find-user --name 'Alexis Torres'
sn-csm-server find-contact-by-portal-user --portal-user-id 238
sn-csm-server find-product --name 'Tomcat 9 Variant 32'
sn-csm-server retrieve-installed-products --account-id 52 --product-id 52
sn-csm-server find-entitlements --account-id 52 --active true
sn-csm-server create-new-case --account-id 25 --contact-id 48 --product-id 32 --installed-product-id 134 --channel web --priority high --state new --short-description 'Product: Tomcat 9 Variant 12, Issue: software failure impacting major operations.'
sn-csm-server create-new-case --account-id 52 --contact-id 120 --product-id 52 --installed-product-id 293 --channel web --priority high --state new --short-description 'Product: Tomcat 9 Variant 32, Issue: software failure impacting major operations.'
sn-csm-server find-sla-definitions --applies-to-priority high --active true
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 2 --stage in_progress
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 7 --stage in_progress
sn-csm-server update-case --case-id 1234 --state in_progress
sn-csm-server link-new-case-sla --case-id 1234 --sla-def-id 2 --stage in_progress
sn-csm-server link-new-case-sla --case-id 1234 --sla-def-id 7 --stage in_progress
sn-csm-server retrieve-knowledge --search-text 'Tomcat 9 Variant 12' --state published --visibility external
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 18 --used-as suggested
sn-csm-server retrieve-knowledge --search-text 'Tomcat 9 Variant 32' --state published --visibility external
sn-csm-server link-case-knowledge --case-id 1234 --knowledge-id 77 --used-as suggested
