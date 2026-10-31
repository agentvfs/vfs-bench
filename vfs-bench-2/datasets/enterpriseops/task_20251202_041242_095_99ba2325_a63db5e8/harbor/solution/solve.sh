#!/usr/bin/env bash
# A solution of task_20251202_041242_095_99ba2325_a63db5e8, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server search-cases --number CS-0000311
sn-csm-server find-user --name 'Christopher Underwood'
sn-csm-server find-user --name 'Katherine Gallegos'
sn-csm-server list-group-members --group-id 79 --user-id 770
sn-csm-server retrieve-knowledge --kb-number KB-0000044
sn-csm-server update-user-details --user-id 432 --active false
sn-csm-server update-case --case-id 311 --priority critical --assigned-to 770
sn-csm-server update-knowledge --knowledge-id 44 --state published
sn-csm-server link-case-knowledge --case-id 311 --knowledge-id 44 --used-as applied
