#!/usr/bin/env bash
# The pre-Harbor port's oracle (complexmcp/business-flight-sf-ny/tests/oracle.sh).
# Upstream's reference trajectory (data.parquet row 21), with its ids read
# from each response.
light-system now

# LightTalk's calls fail at random until its network is accelerated.
light-talk acc-network

name=$(light-talk get-my-name | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["output"])')
uid=$(light-talk get-myuid | grep -o 'user_[A-Za-z0-9]*')
echo "$name $uid"
light-flight add-passenger --name "$name" --light-talk-uid "$uid" | tee /workspace/passenger

light-flight search-flights --departure 'San Francisco' --arrival 'New York' --date 2026-02-27

fid=$(light-flight search-flights --departure 'San Francisco' --arrival 'New York' --date 2026-02-27 | grep -o 'flight_[A-Za-z0-9]*')
light-flight get-flight-details --fid "$fid"
light-flight add-to-booking --fid "$fid" --seat-class business --passenger-idx "$(grep -o 'index = [0-9]*' /workspace/passenger | grep -o '[0-9]*$')"
echo "$fid" > /workspace/fid

# Only the new booking is paid for: drop the one already in the list.
light-flight check-bookings

for bid in $(light-flight check-bookings | python3 -c "import json,sys; print(' '.join(b['bid'] for b in json.loads(sys.stdin.read())['output'] if not b['paid'] and b['fid'] != '$(cat /workspace/fid)'))"); do light-flight remove-from-booking --bid "$bid"; done
light-flight wait-payment-password
light-flight checkout-bookings
