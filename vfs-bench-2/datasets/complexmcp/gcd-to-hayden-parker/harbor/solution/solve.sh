#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 13), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
math-server gcd --a 121312 --b 123178
light-talk get-uid-from-name --name 'Hayden Parker'
light-talk send-message --content 2 --uid user_iFQgKLk6Uzz6EHwttPAqic
