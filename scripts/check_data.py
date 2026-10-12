"""Sanity-check data.js against the CSV and the country borders.
Usage: python3 -I scripts/check_data.py [--online]
  --online also asks YouTube (oEmbed) for every video's real title and checks
  that it carries the same EP number as the sheet.
Exits 1 if any ERROR is found; WARN lines are things a human should look at.
"""
import csv, json, math, re, sys, urllib.request, urllib.parse
from collections import Counter, defaultdict

ROOT = __file__.rsplit('/scripts/', 1)[0]
src = open(f'{ROOT}/data.js', encoding='utf-8').read()
def grab(name):
    m = re.search(r'window\.%s = (.*?);\n' % name, src, re.S)
    return json.loads(m.group(1))
EPS, HUBS, CTRY = grab('FAROSE_EPISODES'), grab('FAROSE_HUBS'), grab('FAROSE_COUNTRIES')
GEO = json.load(open(f'{ROOT}/assets/countries.geojson', encoding='utf-8'))
ROWS = list(csv.DictReader(open(f'{ROOT}/data/farose-gsheet.csv', encoding='utf-8-sig')))

errors, warns = [], []
E, W = errors.append, warns.append

# ---- geometry helpers -------------------------------------------------------
polys = defaultdict(list)  # a3 -> list of outer rings
for f in GEO['features']:
    g = f['geometry']
    for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
        polys[f['properties']['ADM0_A3']].append(p[0])
def inside(lng, lat, ring):
    c, n = False, len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            c = not c
    return c
def km(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
def dist_to_country(lat, lng, a3):  # 0 if inside, else km to the nearest border vertex
    if any(inside(lng, lat, r) for r in polys[a3]): return 0
    return min(km(lat, lng, y, x) for r in polys[a3] for x, y in r)
def country_at(lat, lng):
    return [a3 for a3, rs in polys.items() if any(inside(lng, lat, r) for r in rs)]

# ---- 1. episodes: numbering, duplicates, CSV agreement ----------------------
nums = [e['ep'] for e in EPS]
if nums != list(range(1, len(EPS) + 1)): E(f'episode numbers are not 1..{len(EPS)} in order')
if len(ROWS) != len(EPS): E(f'CSV has {len(ROWS)} rows but data.js has {len(EPS)} episodes')
for vid, n in Counter(e.get('vid') for e in EPS if e.get('vid')).items():
    if n > 1: E(f'video {vid} is used by {n} episodes: {[e["ep"] for e in EPS if e.get("vid") == vid]}')
for e, r in zip(EPS, ROWS):
    if str(e['ep']) != r['EP']: E(f'EP{e["ep"]}: CSV row order mismatch ({r["EP"]})')
    if e['country'] != r['ประเทศ'] or e['city'] != r['เมือง/พื้นที่']: E(f'EP{e["ep"]}: city/country differ from CSV — rebuild data.js')
    m = re.search(r'EP\s*(\d+)', r['ชื่อวิดีโอ'])
    if m and int(m.group(1)) != e['ep']: E(f'EP{e["ep"]}: sheet title says EP{m.group(1)}')
    if not e.get('vid') and r['สถานะวิดีโอ'] == 'Public': W(f'EP{e["ep"]}: marked Public but has no YouTube link')

# ---- 2. hubs: coordinates really are in the stated country -------------------
hub = {h['name']: h for h in HUBS}
TINY = 60   # km: micro-states and coastal cities fall outside 1:110m outlines
for h in HUBS:
    if h['kind'] == 'region': continue
    c = CTRY.get(h['country'])
    if not c: E(f'hub {h["name"]}: country "{h["country"]}" is not in CTRY (no flag, no continent)'); continue
    if c['a3'] not in polys:
        W(f'hub {h["name"]}: {h["country"]} ({c["a3"]}) has no outline in the borders file, so it is not tinted/clickable'); continue
    d = dist_to_country(h['lat'], h['lng'], c['a3'])
    if d > TINY:
        E(f'hub {h["name"]} ({h["lat"]},{h["lng"]}) is {d:.0f} km outside {h["country"]}; that point is in {country_at(h["lat"], h["lng"]) or "the sea"}')
    if not re.search(r'[฀-๿]', h['th']): W(f'hub {h["name"]}: no Thai name')
for a, b in ((x, y) for i, x in enumerate(HUBS) for y in HUBS[i + 1:]):
    if a['th'] == b['th']: W(f'hubs {a["name"]} and {b["name"]} share the Thai name {a["th"]}')
    if km(a['lat'], a['lng'], b['lat'], b['lng']) < 1 and a['kind'] == b['kind'] == 'city': W(f'hubs {a["name"]} and {b["name"]} are at the same spot')

# ---- 3. episodes vs hubs ----------------------------------------------------
for e in EPS:
    hs = [hub.get(n) for n in e.get('hubs', [])]
    if None in hs: E(f'EP{e["ep"]}: unknown hub in {e.get("hubs")}'); continue
    if e['prec'] == 'none':
        if hs: E(f'EP{e["ep"]}: unmapped but has hubs')
        continue
    if not hs: E(f'EP{e["ep"]}: precision {e["prec"]} but no hub'); continue
    if not e.get('stops'):
        h = hs[0]
        if h['country'] != e['country'] and e['prec'] != 'region':
            E(f'EP{e["ep"]}: sheet country {e["country"]} but pinned on {h["name"]} ({h["country"]})')
        if e['prec'] == 'place':
            d = km(e['lat'], e['lng'], h['lat'], h['lng'])
            if d > 40: E(f'EP{e["ep"]}: place "{e["place"]}" is {d:.0f} km from its city pin {h["name"]}')
        if e['prec'] in ('place', 'city') and h['kind'] != 'city': E(f'EP{e["ep"]}: {e["prec"]}-level episode on a {h["kind"]} hub')
    if e.get('conf') == 'High' and e['prec'] in ('country', 'region'):
        W(f'EP{e["ep"]}: sheet confidence is High but only {e["prec"]}-level location ("{e["city"]}")')

# ---- 4. countries -----------------------------------------------------------
for name in sorted({r['ประเทศ'] for r in ROWS}):
    if name not in CTRY and name not in ('Unverified', 'Multiple', ''):
        E(f'country "{name}" appears in the sheet but not in CTRY')
for name, c in CTRY.items():
    if not any(h['country'] == name for h in HUBS): W(f'CTRY has {name} but no hub uses it')

# ---- 5. optional: ask YouTube ------------------------------------------------
if '--online' in sys.argv:
    for e in EPS:
        if not e.get('vid'): continue
        url = 'https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote(f'https://www.youtube.com/watch?v={e["vid"]}')
        try:
            t = json.load(urllib.request.urlopen(url, timeout=15))['title']
        except Exception as ex:
            (W if e.get('status') != 'Public' else E)(f'EP{e["ep"]}: YouTube does not return video {e["vid"]} ({ex})'); continue
        m = re.search(r'EP\.?\s*(\d+)', t, re.I)
        if not m: W(f'EP{e["ep"]}: YouTube title has no EP number: "{t}"')
        elif int(m.group(1)) != e['ep']: E(f'EP{e["ep"]}: YouTube says this video is EP{m.group(1)}: "{t}"')
        elif 'ไกลบ้าน' not in t: W(f'EP{e["ep"]}: YouTube title lacks ไกลบ้าน: "{t}"')

by_prec = Counter(e['prec'] for e in EPS)
print(f'{len(EPS)} episodes · {len(HUBS)} hubs · {len({h["country"] for h in HUBS if h["country"] in CTRY})} countries · precision {dict(by_prec)}')
for w in warns: print('WARN ', w)
for x in errors: print('ERROR', x)
print(f'{len(errors)} error(s), {len(warns)} warning(s)')
sys.exit(1 if errors else 0)
