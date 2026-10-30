#!/usr/bin/env bash
# A solution of task_20251231_123548_425_8cd8e61e_9303271e, written for this port (enterpriseops/solutions/);
# it passes upstream's verifiers on upstream's image and on the fake.
sn-csm-server find-account --name Globex
sn-csm-server list-users --first-name Derek --email derek.blake7@globex.com
sn-csm-server find-contacts --account-id 4 --portal-user-id 622
sn-csm-server find-interactions --account-id 4 --contact-id 3 --channel alert --status open
sn-csm-server retrieve-knowledge --search-text 'snapshot rollback Btrfs Snapper' --state published --visibility external --limit 5
sn-csm-server update-interaction --interaction-id 80 --status handled
sn-csm-server link-case-knowledge --case-id 80 --knowledge-id 7 --used-as suggested
sn-csm-server send-notification --case-id 80 --knowledge-id 7 --email derek.blake7@globex.com --type solution_proposal
