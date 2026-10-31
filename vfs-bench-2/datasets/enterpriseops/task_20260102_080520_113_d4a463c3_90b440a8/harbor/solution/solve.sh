#!/usr/bin/env bash
# A solution of task_20260102_080520_113_d4a463c3_90b440a8, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name ServiceNow
sn-csm-server find-locations --city tokyo --name Servicenow
sn-csm-server find-locations --city tokyo
sn-csm-server retrieve-installed-products --account-id 1 --location-id 804
sn-csm-server update-location --location-id 803 --active true
sn-csm-server update-installed-product-details --installed-product-id 4 --location-id 803
sn-csm-server update-location --location-id 804 --active false
