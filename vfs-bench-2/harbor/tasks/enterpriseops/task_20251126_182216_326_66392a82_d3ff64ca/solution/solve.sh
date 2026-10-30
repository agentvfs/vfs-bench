#!/usr/bin/env bash
# A solution of task_20251126_182216_326_66392a82_d3ff64ca, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Carrillo Inc'
sn-csm-server retrieve-installed-products --account-id 19
sn-csm-server find-locations --location-id 840
sn-csm-server find-locations --location-id 839
sn-csm-server update-location --location-id 839 --active true
sn-csm-server update-installed-product-details --installed-product-id 98 --location-id 839
sn-csm-server retrieve-installed-products --location-id 839
sn-csm-server update-installed-product-details --installed-product-id 102 --status in_use
sn-csm-server update-location --location-id 840 --active false
