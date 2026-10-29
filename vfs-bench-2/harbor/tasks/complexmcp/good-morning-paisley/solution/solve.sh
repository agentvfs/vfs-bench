#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 1), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-uid-from-name --name Paisley
light-talk get-all-contacts
light-system now
light-talk send-message --uid user_DG7ntRdAwsypt3jLwospHn --content 'Good morning'
light-talk unblock --uid user_DG7ntRdAwsypt3jLwospHn
light-talk ask-for-privilege
light-talk unblock --uid user_DG7ntRdAwsypt3jLwospHn
light-talk acc-network
light-talk unblock --uid user_DG7ntRdAwsypt3jLwospHn
light-talk send-message --uid user_DG7ntRdAwsypt3jLwospHn --content 'Good morning'
light-talk block --uid user_DG7ntRdAwsypt3jLwospHn
