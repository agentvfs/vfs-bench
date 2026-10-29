# Must pass: oracle.sh spending the last day trade on MSFT before the
# upgrade, then buying AAPL, NVDA and GOOGL. The trading balance comes to
# 18579.74 where the expected one is 18579.739999999998; the judge rounds
# floats.
light-system now

light-stock list-all-tickers-by-sector --sector Technology

# The top 4 by market cap ("3.87T", "503.38B").
for t in $(light-stock list-all-tickers-by-sector --sector Technology | grep -o '"[A-Z]*"' | tr -d '"'); do light-stock get-stock-details --ticker "$t"; done | python3 -c '
import json, sys
stocks = [json.loads(line)["output"] for line in sys.stdin if line.strip()]
cap = lambda s: float(s["market_cap"][:-1]) * {"T": 1e12, "B": 1e9, "M": 1e6}[s["market_cap"][-1]]
for s in sorted(stocks, key=cap, reverse=True)[:4]:
    print(s["ticker"], s["market_cap"])
' | tee /workspace/top

# A Basic account has one day trade left and four are needed, so upgrade.
light-stock get-account-summary
light-stock get-day-trades-remaining
light-stock check-vip-price

light-stock wait-trade-password
light-stock place-market-order --ticker MSFT --side buy --quantity 10
light-stock wait-trade-password
light-stock upgrade-to-vip
light-stock wait-trade-password
light-stock place-market-order --ticker AAPL --side buy --quantity 10
light-stock wait-trade-password
light-stock place-market-order --ticker NVDA --side buy --quantity 10
light-stock wait-trade-password
light-stock place-market-order --ticker GOOGL --side buy --quantity 10

light-stock get-trade-history

# The top-ranked stock's ticker and its trade's value without the fee, as
# two messages. LightTalk's calls fail at random until its network is
# accelerated.
light-talk acc-network
light-talk fuzzy-search-uids-from-name --name Judith

uid=$(light-talk fuzzy-search-uids-from-name --name Judith | grep -o 'user_[A-Za-z0-9]*')
top=$(head -1 /workspace/top | cut -d' ' -f1)
value=$(light-stock get-trade-history | python3 -c "import json,sys; print(round(next(t['total_amount'] for t in json.loads(sys.stdin.read())['output'] if t['ticker'] == '$top' and t['side'] == 'buy' and t['quantity'] == 10), 2))")
light-talk send-message --uid "$uid" --content "$top"
light-talk send-message --uid "$uid" --content "$value"

# Next Tuesday, economy, for yourself.
light-flight search-airports --airport-name 'Shanghai Hongqiao'

date=$(light-system now | python3 -c 'import json,sys,datetime; d=datetime.date.fromisoformat(json.loads(sys.stdin.read())["output"][:10]); print((d + datetime.timedelta(days=(1 - d.weekday()) % 7 or 7)).isoformat())')
for fid in $(light-flight search-flights --departure Shanghai --arrival Berlin --date "$date" | grep -o 'flight_[A-Za-z0-9]*'); do light-flight get-flight-details --fid "$fid"; done | grep 'Hongqiao' | tee /workspace/flight

light-flight check-bookings
light-flight check-passengers

name=$(light-talk get-my-name | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["output"])')
uid=$(light-talk get-myuid | grep -o 'user_[A-Za-z0-9]*')
light-flight add-passenger --name "$name" --light-talk-uid "$uid" | tee /workspace/passenger
idx=$(grep -o 'index = [0-9]*' /workspace/passenger | grep -o '[0-9]*$')
light-flight add-to-booking --fid "$(grep -o 'flight_[A-Za-z0-9]*' /workspace/flight)" --seat-class economy --passenger-idx "$idx"
light-flight wait-payment-password
light-flight checkout-bookings

# The cart starts with items in it, which go first. Bitter gourd is sold as
# bitter melon.
light-shop get-cart-summary

for caid in $(light-shop get-cart-summary | grep -o 'cart_[A-Za-z0-9]*'); do light-shop delete-item-in-cart --caid "$caid"; done
light-shop search-items --item-name 'bitter gourd'
light-shop search-items --item-name 'bitter melon'

item=$(light-shop search-items --item-name 'bitter melon' | python3 -c 'import json,sys; i=next(i for i in json.loads(sys.stdin.read())["output"] if "(1kg)" in i["name"]); print(i["tid"], i["shop"])')
tid=${item%% *}
sid=$(light-shop get-shop-id-by-name --shop-name "${item#* }" | grep -o 'shop_[A-Za-z0-9]*')
light-shop add-to-cart --sid "$sid" --tid "$tid" --cnt 1

# The payment password is sometimes refused; enter it until it is taken.
for try in 1 2 3 4 5; do light-shop wait-payment-password | tee /workspace/password; grep -q '"status":"ok"' /workspace/password && break; done
light-shop checkout-all
