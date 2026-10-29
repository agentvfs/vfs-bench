#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 10), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk list-ip-choices
light-talk change-my-ip --where 'New York'
light-talk post-moment --content 'Hello, world.'
light-talk ask-for-privilege
light-talk post-moment --content 'Hello, world.'
light-talk acc-network
light-talk post-moment --content 'Hello, world.'
