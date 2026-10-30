#!/usr/bin/env bash
# A solution of task_20251208_035402_755_ad5a67e3_8ca9a646, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Initech
sn-csm-server list-users --first-name Thomas --last-name Bailey
sn-csm-server find-contact-by-portal-user --portal-user-id 63
sn-csm-server search-cases --account-id 5 --contact-id 5 --channel phone
sn-csm-server find-product --name 'Docker Enterprise Variant 15'
sn-csm-server retrieve-knowledge --product-id 35 --state published
sn-csm-server update-case --case-id 101 --product-id 35 --state in_progress --short-description 'Product: Docker Enterprise Variant 15, Issue: is not working as expected.'
sn-csm-server link-case-knowledge --case-id 101 --knowledge-id 54 --used-as applied
