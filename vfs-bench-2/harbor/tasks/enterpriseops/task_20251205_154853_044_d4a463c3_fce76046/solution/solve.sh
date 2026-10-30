#!/usr/bin/env bash
# A solution of task_20251205_154853_044_d4a463c3_fce76046, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-locations --city london --country uk
sn-csm-server retrieve-installed-products --location-id 817
sn-csm-server update-installed-product-details --installed-product-id 40 --location-id 692 --status in_use
sn-csm-server find-contacts --account-id 8 --active true
sn-csm-server list-users --user-id 20
sn-csm-server list-users --user-id 287
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 25 --installed-product-id 40 --channel alert --priority low --state new --short-description 'Product: SUSE Linux Enterprise Server 15 Variant 5, relocated to London Pratt Curve site'
sn-csm-server update-case --case-id 1233 --state resolved
sn-csm-server update-case --case-id 1233 --state closed --closed-on 2025-12-05
sn-csm-server send-notification --case-id 1233 --email marc.henry@stark-industries.com --type update
sn-csm-server send-notification --case-id 1233 --email tonya.stevens@stark-industries.com --type update
