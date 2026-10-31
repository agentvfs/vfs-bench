#!/usr/bin/env bash
# A solution of task_20260102_172945_725_ad5a67e3_5480e26f, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Umbrella
sn-csm-server find-locations --city tokyo --name 'Umbrella Site A - Tokyo'
sn-csm-server find-product --name 'Red Hat Enterprise Linux 9'
sn-csm-server register-new-installed-product --location-id 814 --account-id 6 --product-id 3 --serial-number RHEL-UMB-4500 --status in_use --warranty-end 2026-12-31
sn-csm-server find-contacts --account-id 6 --is-primary true --active true
sn-csm-server create-new-case --account-id 6 --contact-id 7 --product-id 3 --installed-product-id 301 --channel phone --priority high --state new --short-description 'Product: Red Hat Enterprise Linux 9, Issue: node crashes frequently.'
sn-csm-server find-user --name 'Travis Wood'
sn-csm-server find-user-group --name 'Proactive Case Monitoring'
sn-csm-server add-new-group-member --group-id 11 --user-id 11
sn-csm-server find-sla-definitions --applies-to-priority high --metric response --active true
sn-csm-server update-case --case-id 1233 --state in_progress
sn-csm-server link-new-case-sla --case-id 1233 --sla-def-id 2 --stage in_progress
