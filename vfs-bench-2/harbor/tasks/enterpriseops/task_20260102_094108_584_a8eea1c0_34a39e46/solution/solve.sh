#!/usr/bin/env bash
# A solution of task_20260102_094108_584_a8eea1c0_34a39e46, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name 'Stark Industries'
sn-csm-server retrieve-installed-products --account-id 8 --product-id 25
sn-csm-server find-entitlements --account-id 8 --product-id 25 --support-level premium --active true
sn-csm-server find-contacts --account-id 8 --is-primary true
sn-csm-server create-new-case --account-id 8 --contact-id 10 --product-id 25 --installed-product-id 40 --channel phone --priority high --state new --short-description 'Product: SUSE Linux Enterprise Server 15 Variant 5, Issue: critical network errors at datacenter.'
sn-csm-server find-user-group --name 'Contact Center L1_2'
sn-csm-server set-case-assignment-group --case-id 1233 --assignment-group-id 28
sn-csm-server retrieve-knowledge --product-id 25 --state published
sn-csm-server link-case-knowledge --case-id 1233 --knowledge-id 38 --used-as suggested
