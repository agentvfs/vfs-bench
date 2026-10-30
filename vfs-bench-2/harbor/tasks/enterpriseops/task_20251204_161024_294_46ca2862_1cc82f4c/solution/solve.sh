#!/usr/bin/env bash
# A solution of task_20251204_161024_294_46ca2862_1cc82f4c, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name ServiceNow
sn-csm-server find-locations --street 'Janice Landing'
sn-csm-server find-locations --plot-no 'Plot 738' --city tokyo
sn-csm-server retrieve-installed-products --account-id 1
sn-csm-server find-contacts --account-id 1
sn-csm-server list-users --user-id 801
sn-csm-server update-installed-product-details --installed-product-id 1 --location-id 804 --status in_use
sn-csm-server update-user-details --user-id 801 --location-id 804
