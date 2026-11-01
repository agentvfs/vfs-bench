#!/usr/bin/env bash
# A solution of task_20251205_060649_946_66392a82_354af85a, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-contracts --status active --contract-type warranty
sn-csm-server update-contract --contract-id 100 --end-date 2027-02-07
sn-csm-server update-contract --contract-id 115 --end-date 2027-02-28
sn-csm-server update-contract --contract-id 33 --end-date 2028-02-24
sn-csm-server update-contract --contract-id 56 --end-date 2028-02-26
sn-csm-server update-contract --contract-id 60 --end-date 2028-02-04
sn-csm-server update-contract --contract-id 117 --end-date 2028-02-12
