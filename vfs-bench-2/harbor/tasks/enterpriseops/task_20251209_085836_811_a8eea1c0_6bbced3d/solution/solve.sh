#!/usr/bin/env bash
# A solution of task_20251209_085836_811_a8eea1c0_6bbced3d, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server list-users --first-name Thomas --last-name Green
sn-csm-server update-user-details --user-id 1 --active true
sn-csm-server find-user-by-email --email sarah.connor.new@servicenow.com
sn-csm-server find-location --name 'User 4 - Tokyo'
sn-csm-server add-new-user --first-name Sarah --last-name Connor --email sarah.connor.new@servicenow.com --role agent --location-id 4 --active true
sn-csm-server find-user-group --name 'CSM Tier 1 Support'
sn-csm-server add-new-group-member --group-id 1 --user-id 803
sn-csm-server find-products --name 'Quantum Firewall 5000'
sn-csm-server add-new-product --name 'Quantum Firewall 5000' --category hardware --lifecycle-state active
sn-csm-server create-knowledge --title 'Quantum Firewall 5000 release: preliminary support guide' --body 'Preliminary notes for the Quantum Firewall 5000 hardware release, handled by CSM Tier 1 Support.' --state draft --visibility internal --product-id 241 --owner-id 803
