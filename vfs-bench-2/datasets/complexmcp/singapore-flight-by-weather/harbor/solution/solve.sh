#!/usr/bin/env bash
# Upstream's reference trajectory (data.parquet row 42), each
# call as the CLI that makes it. Its ids are the session's own, which
# the seed makes the same each time; calls the client never sent to a
# server (an unknown tool, a malformed call) are left out.
light-weather get-forecast --location Singapore --days 10
light-system now
light-flight search-flights --departure Chicago --arrival Singapore --date 2026-07-14
light-flight search-flights --departure Chicago --arrival Singapore --date 2026-07-13
light-flight search-flights --departure Chicago --arrival Singapore --date 2026-07-12
light-flight search-flights --departure Chicago --arrival Singapore --date 2026-07-13
light-flight get-flight-details --fid flight_23B6NKD6SXf77G4AQmMPKx
light-flight check-balance
light-flight check-passengers
light-talk get-my-name
light-talk get-myuid
light-flight add-passenger --name 'Chase Shaw' --light-talk-uid user_VffA2PHphcZfATBu5p6hMR
light-flight add-to-booking --fid flight_23B6NKD6SXf77G4AQmMPKx --seat-class business --passenger-idx 0
light-flight check-bookings
light-flight wait-payment-password
light-flight checkout-bookings
light-talk fuzzy-search-uids-from-name --name Brown
light-talk send-message --content '2026-07-14 12:33:10' --uid user_NZAvtgH8nWVNhTkTd4LseT
