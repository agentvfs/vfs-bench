#!/usr/bin/env bash
# Ours, written by hand through the CLIs.
# Upstream's reference trajectory (data.parquet row 45), with its ids read
# from each response. Each trade needs the trading password first.
light-system now

light-stock get-pending-orders

for oid in $(light-stock get-pending-orders | grep -o 'order_[A-Za-z0-9]*'); do light-stock cancel-order --oid "$oid"; done

light-stock get-portfolio

light-stock get-portfolio | python3 -c 'import json,sys; [print(p["ticker"], p["quantity"]) for p in json.loads(sys.stdin.read())["output"]]' | while read ticker quantity; do
  light-stock wait-trade-password
  light-stock place-market-order --ticker "$ticker" --side sell --quantity "$quantity"
done

# The account is VIP, so it can sell short.
light-stock get-account-summary

light-stock wait-trade-password
light-stock place-market-order --ticker AAPL --side sell --quantity 50

# LightNews is LightTown's, the city meant. The link goes to yourself.
light-news list-all-sections

light-news search --section 'Local Business' --query toy --maxn 5 --begin-date 2026-01-01 --end-date 2026-04-01

nid=$(light-news search --section 'Local Business' --query toy --maxn 5 --begin-date 2026-01-01 --end-date 2026-04-01 | grep -o 'news_[A-Za-z0-9]*')
url=$(light-news get-news-url --nid "$nid" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["output"])')
# LightTalk's calls fail at random until its network is accelerated.
light-talk acc-network
light-talk get-my-name
uid=$(light-talk get-myuid | grep -o 'user_[A-Za-z0-9]*')
light-talk send-message --uid "$uid" --content "$url"

# The day after tomorrow's cheapest economy seat, Zurich to Warsaw Chopin.
light-flight list-airports-by-city --city Warsaw

date=$(light-system now | python3 -c 'import json,sys,datetime; print((datetime.date.fromisoformat(json.loads(sys.stdin.read())["output"][:10]) + datetime.timedelta(days=2)).isoformat())')
for fid in $(light-flight search-flights --departure Zurich --arrival Warsaw --date "$date" | grep -o 'flight_[A-Za-z0-9]*'); do light-flight get-flight-details --fid "$fid"; done | tee /workspace/flights

# Only the new booking is paid for: drop the one already in the list.
light-flight check-bookings

for bid in $(light-flight check-bookings | python3 -c "import json,sys; print(' '.join(b['bid'] for b in json.loads(sys.stdin.read())['output'] if not b['paid']))"); do light-flight remove-from-booking --bid "$bid"; done
light-flight check-passengers

name=$(light-talk get-my-name | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["output"])')
uid=$(light-talk get-myuid | grep -o 'user_[A-Za-z0-9]*')
light-flight add-passenger --name "$name" --light-talk-uid "$uid" | tee /workspace/passenger
idx=$(grep -o 'index = [0-9]*' /workspace/passenger | grep -o '[0-9]*$')
fid=$(python3 -c 'import json; f=[json.loads(l)["output"] for l in open("/workspace/flights")]; print(min(f, key=lambda f: f["price"]["ecomony"])["fid"])')
light-flight add-to-booking --fid "$fid" --seat-class economy --passenger-idx "$idx"
light-flight wait-payment-password
light-flight checkout-bookings
