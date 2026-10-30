#!/usr/bin/env bash
# A solution of task_20251205_194841_224_391f1eff_136bedae, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-user --name 'Derek Blake'
sn-csm-server find-contact-by-portal-user --portal-user-id 622
sn-csm-server find-product --name 'VMware vSphere Enterprise Plus'
sn-csm-server find-entitlements --account-id 4 --active true
sn-csm-server create-new-case --account-id 4 --contact-id 3 --product-id 14 --channel web --priority moderate --state new --short-description 'Product: VMware vSphere Enterprise Plus, Issue: is not working as expected.'
sn-csm-server retrieve-knowledge --product-id 14 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 22 --used-as suggested
