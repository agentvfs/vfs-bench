#!/usr/bin/env bash
# A solution of task_20251127_152838_396_99ba2325_8391501f, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Simon LLC'
sn-csm-server find-locations --name 'Simon Llc Site A - New York'
sn-csm-server find-locations --name 'Simon Llc Site B - New York'
sn-csm-server retrieve-installed-products --account-id 45 --location-id 892 --status repair
sn-csm-server update-location --location-id 892 --active false
sn-csm-server update-installed-product-details --installed-product-id 250 --location-id 907 --status in_use
sn-csm-server find-contacts --account-id 45 --is-primary true
sn-csm-server list-users --user-id 74
sn-csm-server create-new-case --account-id 45 --contact-id 103 --product-id 113 --installed-product-id 250 --channel alert --priority moderate --state new --short-description 'Asset P113-336951-9659 relocated from Simon Llc Site A to Site B - New York and set in use'
sn-csm-server send-notification --case-id 1233 --email kayla.lutz@simonllc.com --type alert
