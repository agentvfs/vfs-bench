#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 19), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-talk get-all-contacts
light-talk send-message --content Hello --uid user_uDXUcfqTM65zASDGxQuQMj
light-talk send-message --content Hello --uid user_qiQZk2HhpCRufEEAXZn7bu
light-talk send-message --content Hello --uid user_wv2dYs47diQVcZgWfQ73Kq
light-talk send-message --content Hello --uid user_wv2dYs47diQVcZgWfQ73Kq
light-talk acc-network
light-talk send-message --content Hello --uid user_wv2dYs47diQVcZgWfQ73Kq
light-talk unblock --uid user_wv2dYs47diQVcZgWfQ73Kq
light-talk ask-for-privilege
light-talk unblock --uid user_wv2dYs47diQVcZgWfQ73Kq
light-talk send-message --content Hello --uid user_wv2dYs47diQVcZgWfQ73Kq
