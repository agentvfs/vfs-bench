#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 41), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-weather set-primary-location --location 'New York'
light-weather get-sun-times --location 'New York'
time-server iso-seconds-diff --t1 2026-06-25T22:28:58 --t2 2026-06-26T10:28:58
light-talk get-uid-from-name --name 'Aaliyah Gonzalez'
light-talk get-uid-from-name --name 'Aaliyah Gonzalez'
light-talk acc-network
light-talk get-uid-from-name --name 'Aaliyah Gonzalez'
light-talk unblock --uid user_yXQoaVh5YRxvHU9SpuVLCd
light-talk ask-for-privilege
light-talk unblock --uid user_yXQoaVh5YRxvHU9SpuVLCd
light-talk send-message --content 50.00% --uid user_yXQoaVh5YRxvHU9SpuVLCd
