#!/usr/bin/env bash
# A solution of task_20260102_171008_763_ad5a67e3_cb101d3b, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Elizabeth Chase'
sn-csm-server find-contact-by-portal-user --portal-user-id 801
sn-csm-server find-product --name 'Palo Alto Networks PA-3220'
sn-csm-server search-cases --contact-id 123 --product-id 128 --priority critical --state new
sn-csm-server retrieve-knowledge --product-id 128
sn-csm-server update-knowledge --knowledge-id 195 --state published
sn-csm-server link-case-knowledge --case-id 1 --knowledge-id 195 --used-as resolution
sn-csm-server update-case --case-id 1 --state in_progress
sn-csm-server find-case-slas --case-id 1
sn-csm-server update-case-sla-details --case-sla-id 1 --stage in_progress
sn-csm-server update-case-sla-details --case-sla-id 2 --stage in_progress
sn-csm-server send-notification --case-id 1 --knowledge-id 195 --email elizabeth.chase32@servicenow.com --type update
