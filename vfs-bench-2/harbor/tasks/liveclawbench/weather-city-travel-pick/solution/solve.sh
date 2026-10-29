#!/usr/bin/env bash
# Upstream's solution, with the service fetched by curl (vfs-bench-2):
# upstream's fetches it from Python with urllib, and python3 here has no
# network. The selection and the answer are upstream's.
set -e
mkdir -p /workspace/output

BASE="http://localhost:3000"
mkdir -p /tmp/weather
curl -s "$BASE/api/locations" > /tmp/weather/locations.json
for slug in shanghai beijing shenzhen chengdu harbin; do
  curl -s "$BASE/api/location/$slug/air-quality" > "/tmp/weather/$slug.aqi.json"
  curl -s "$BASE/location/$slug" > "/tmp/weather/$slug.html"
done

python3 - <<'PYEOF'
import json
import re

# Known slugs for the five seeded cities.
# The task asks for the city slug (URL identifier), not the display name.
KNOWN_SLUGS = {"shanghai", "beijing", "shenzhen", "chengdu", "harbin"}


def read_json(path):
    with open(path, encoding="utf-8") as r:
        return json.load(r)


def read_html(path):
    with open(path, encoding="utf-8", errors="replace") as r:
        return r.read()


resp = read_json("/tmp/weather/locations.json")
cities = resp["data"]

best = None

for city in cities:
    slug = city["slug"]
    if slug not in KNOWN_SLUGS:
        continue

    aq = read_json(f"/tmp/weather/{slug}.aqi.json")
    aqi = int(aq["data"]["aqi"])

    html = read_html(f"/tmp/weather/{slug}.html")
    # High temp appears in <div style="font-size:48px;font-weight:200">22°C</div>.
    # Match only the ASCII digits to avoid encoding-sensitive °C / Chinese text.
    m = re.search(r"font-size:48px[^>]*>(\d+)", html)
    temp = int(m.group(1)) if m else 0

    if 15 <= temp <= 26 and aqi <= 50 and (best is None or aqi < best["aqi"]):
        best = {"city": slug, "aqi": aqi, "temp_high_c": temp}

if best is None:
    raise RuntimeError("No qualifying city found")

best["reason"] = (
    f"{best['city']} has the lowest AQI ({best['aqi']}) among qualifying cities "
    f"and a comfortable high of {best['temp_high_c']}°C."
)

with open("/workspace/output/travel_pick.json", "w", encoding="utf-8") as f:
    json.dump(best, f, ensure_ascii=False)
print("Written:", best)
PYEOF
