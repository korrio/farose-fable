"""Build data.js for the globe from the FAROSE CSV export.
Usage: python3 scripts/build_data.py path/to/farose-gsheet.csv > data.js
Coordinates are hand-assigned (the sheet only has Maps search links).
precision: place | city | region | country | none
"""
import csv, json, re, sys

C = {  # city / region / country anchors
 'Vienna':(48.2082,16.3738),'Heidelberg':(49.3988,8.6724),'Paris':(48.8566,2.3522),
 'New York City':(40.7128,-74.0060),'Mexico City':(19.4326,-99.1332),'San Francisco':(37.7749,-122.4194),
 'Würzburg':(49.7913,9.9534),'Strasbourg':(48.5734,7.7521),'Bratislava':(48.1486,17.1077),
 'Bandar Seri Begawan':(4.9031,114.9398),'Kawasaki':(35.5308,139.7029),'Tokyo':(35.6762,139.6503),
 'Kyoto':(35.0116,135.7681),'Nagoya':(35.1815,136.9066),'Kota Kinabalu':(5.9804,116.0735),
 'Havana':(23.1136,-82.3666),'Munich':(48.1351,11.5820),'Vatican City':(41.9029,12.4534),
 'Siena':(43.3188,11.3308),'Berkeley':(37.8715,-122.2730),'Madrid':(40.4168,-3.7038),
 'Milan':(45.4642,9.1900),'Crans-Montana':(46.3100,7.4800),'Stanford':(37.4275,-122.1697),
 'Chichén Itzá':(20.6843,-88.5678),'Lake Tahoe':(39.0968,-120.0324),'Loire Valley':(47.4000,1.2000),
 'Rome':(41.9028,12.4964),'Bologna':(44.4949,11.3426),'Lourdes':(43.0947,-0.0459),
 'Los Angeles':(34.0522,-118.2437),'Hawaii':(20.7984,-156.3319),'Auvers-sur-Oise':(49.0715,2.1696),
 'Seattle':(47.6062,-122.3321),'Dubai':(25.2048,55.2708),'Copenhagen':(55.6761,12.5683),
 'Pearl Harbor':(21.3649,-157.9500),'Hanoi':(21.0278,105.8342),'Singapore':(1.3521,103.8198),
 'George Town':(5.4141,100.3288),'Bangkok':(13.7563,100.5018),'San Diego':(32.7157,-117.1611),
 'London':(51.5074,-0.1278),'Pisa':(43.7228,10.4017),'Beijing':(39.9042,116.4074),
 'Melbourne':(-37.8136,144.9631),'Pompeii':(40.7489,14.4848),'Hong Kong':(22.3193,114.1694),
 'Lisbon':(38.7223,-9.1393),'Yokohama':(35.4437,139.6380),'Cambridge':(52.2053,0.1218),
 'Naples':(40.8518,14.2681),'Seoul':(37.5665,126.9780),'Hiroshima':(34.3853,132.4553),
 'Cambridge, Massachusetts':(42.3736,-71.1097),'Prague':(50.0755,14.4378),'Yangon':(16.8409,96.1735),
 'Hainan':(19.2000,109.7000),'Disneyland Paris':(48.8722,2.7758),'Florence':(43.7696,11.2558),
 # country centroids (city unverified)
 'Germany':(51.1657,10.4515),'Spain':(40.4637,-3.7492),'United States':(39.8283,-98.5795),
 'Denmark':(56.2639,9.5018),'England':(52.3555,-1.1743),'United Kingdom':(54.0,-2.5),
 'Australia':(-25.2744,133.7751),'Italy':(42.8,12.5),'Finland':(62.5,25.7),
 'Europe':(45.5,-7.0),  # label floats over the Bay of Biscay, off the crowded mainland
}
P = {  # specific places, keyed by the sheet's "สถานที่หลัก"
 'Eiffel Tower':(48.8584,2.2945),'Strasbourg Christmas Market':(48.5834,7.7458),
 'Central Park':(40.7829,-73.9654),'United Nations Headquarters':(40.7489,-73.9680),
 'Kanamara Matsuri':(35.5338,139.7290),'San Francisco Pride':(37.7793,-122.4193),
 'Père Lachaise Cemetery':(48.8614,2.3933),'Oktoberfest':(48.1316,11.5498),
 'University of California, Berkeley':(37.8719,-122.2585),'Les Roches':(46.3060,7.4950),
 'Pitié-Salpêtrière Hospital':(48.8385,2.3622),'Stanford University':(37.4275,-122.1697),
 'Angels & Demons route':(41.8986,12.4769),'Notre-Dame / Île de la Cité':(48.8530,2.3499),
 'Khana Ratsadon historic sites':(48.8504,2.3462),'University of Bologna':(44.4962,11.3528),
 'Musée Guimet':(48.8650,2.2936),'Sanctuary of Our Lady of Lourdes':(43.0975,-0.0583),
 'Hollywood':(34.0928,-118.3287),'Van Gogh sites':(49.0715,2.1696),
 'Pike Place Market / original Starbucks':(47.6097,-122.3422),'Pearl Harbor, Oahu':(21.3649,-157.9500),
 'Assumption Cathedral':(13.7236,100.5148),'University of Tokyo':(35.7126,139.7620),
 'Leaning Tower of Pisa':(43.7230,10.3966),'Forbidden City':(39.9163,116.3972),
 'Pompeii Archaeological Park':(40.7489,14.4848),'Saint-Sulpice Church':(48.8510,2.3348),
 'University of Cambridge':(52.2043,0.1149),'East London':(51.5246,-0.0597),
 'Harvard University':(42.3770,-71.1167),'Paris 2024 opening ceremony':(48.8616,2.2893),
 'Paris 2024 volleyball final':(48.8322,2.2876),'Golden Gate area':(37.8078,-122.4750),
 'Disneyland Paris':(48.8722,2.7758),'Chichén Itzá, Yucatán':(20.6843,-88.5678),
}
MULTI = {  # ordered stops for multi-city episodes
 '17':['Tokyo','Kyoto','Nagoya'],
 '79':['Paris','Strasbourg','Munich','Vienna','Copenhagen'],
}

TH = {
 'Vienna':'เวียนนา','Heidelberg':'ไฮเดลเบิร์ก','Paris':'ปารีส','New York City':'นิวยอร์ก',
 'Mexico City':'เม็กซิโกซิตี','San Francisco':'ซานฟรานซิสโก','Würzburg':'เวิร์ซบวร์ก',
 'Strasbourg':'สตราสบูร์ก','Bratislava':'บราติสลาวา','Bandar Seri Begawan':'บันดาร์เสรีเบกาวัน',
 'Kawasaki':'คาวาซากิ','Tokyo':'โตเกียว','Kyoto':'เกียวโต','Nagoya':'นาโกย่า',
 'Kota Kinabalu':'โกตากินาบาลู','Havana':'ฮาวานา','Munich':'มิวนิก','Vatican City':'วาติกัน',
 'Siena':'เซียนา','Berkeley':'เบิร์กลีย์','Madrid':'มาดริด','Milan':'มิลาน',
 'Crans-Montana':'ครองส์-มงตานา','Stanford':'สแตนฟอร์ด','Chichén Itzá':'ชิเชนอิตซา',
 'Lake Tahoe':'ทะเลสาบแทโฮ','Loire Valley':'หุบเขาลัวร์','Rome':'โรม','Bologna':'โบโลญญา',
 'Lourdes':'ลูร์ด','Los Angeles':'ลอสแอนเจลิส','Hawaii':'ฮาวาย','Auvers-sur-Oise':'โอแวร์-ซูร์-อวซ',
 'Seattle':'ซีแอตเทิล','Dubai':'ดูไบ','Copenhagen':'โคเปนเฮเกน','Pearl Harbor':'เพิร์ลฮาร์เบอร์',
 'Hanoi':'ฮานอย','Singapore':'สิงคโปร์','George Town':'ปีนัง','Bangkok':'กรุงเทพฯ',
 'San Diego':'ซานดิเอโก','London':'ลอนดอน','Pisa':'ปิซา','Beijing':'ปักกิ่ง',
 'Melbourne':'เมลเบิร์น','Pompeii':'ปอมเปอี','Hong Kong':'ฮ่องกง','Lisbon':'ลิสบอน',
 'Yokohama':'โยโกฮามา','Cambridge':'เคมบริดจ์','Naples':'เนเปิลส์','Seoul':'โซล',
 'Hiroshima':'ฮิโรชิมา','Cambridge, Massachusetts':'ฮาร์วาร์ด เคมบริดจ์','Prague':'ปราก',
 'Yangon':'ย่างกุ้ง','Hainan':'ไหหลำ','Disneyland Paris':'ดิสนีย์แลนด์ปารีส','Florence':'ฟลอเรนซ์',
 'Germany':'เยอรมนี','Spain':'สเปน','United States':'สหรัฐอเมริกา','Denmark':'เดนมาร์ก',
 'England':'อังกฤษ','United Kingdom':'สหราชอาณาจักร','Australia':'ออสเตรเลีย','Italy':'อิตาลี',
 'Finland':'ฟินแลนด์','Europe':'ยุโรป',
}
# country -> (thai, iso2, adm0_a3, continent)
CTRY = {
 'Austria':('ออสเตรีย','AT','AUT','Europe'),'Germany':('เยอรมนี','DE','DEU','Europe'),
 'France':('ฝรั่งเศส','FR','FRA','Europe'),'United States':('สหรัฐอเมริกา','US','USA','Americas'),
 'Mexico':('เม็กซิโก','MX','MEX','Americas'),'Slovakia':('สโลวาเกีย','SK','SVK','Europe'),
 'Brunei':('บรูไน','BN','BRN','Asia'),'Japan':('ญี่ปุ่น','JP','JPN','Asia'),
 'Malaysia':('มาเลเซีย','MY','MYS','Asia'),'Cuba':('คิวบา','CU','CUB','Americas'),
 'Vatican City':('นครรัฐวาติกัน','VA','VAT','Europe'),'Italy':('อิตาลี','IT','ITA','Europe'),
 'Spain':('สเปน','ES','ESP','Europe'),'Switzerland':('สวิตเซอร์แลนด์','CH','CHE','Europe'),
 'Denmark':('เดนมาร์ก','DK','DNK','Europe'),'United Arab Emirates':('สหรัฐอาหรับเอมิเรตส์','AE','ARE','Middle East'),
 'Vietnam':('เวียดนาม','VN','VNM','Asia'),'Singapore':('สิงคโปร์','SG','SGP','Asia'),
 'Thailand':('ไทย','TH','THA','Asia'),'United Kingdom':('สหราชอาณาจักร','GB','GBR','Europe'),
 'China':('จีน','CN','CHN','Asia'),'Australia':('ออสเตรเลีย','AU','AUS','Oceania'),
 'Hong Kong':('ฮ่องกง','HK','HKG','Asia'),'Portugal':('โปรตุเกส','PT','PRT','Europe'),
 'South Korea':('เกาหลีใต้','KR','KOR','Asia'),'Finland':('ฟินแลนด์','FI','FIN','Europe'),
 'Czech Republic':('เช็กเกีย','CZ','CZE','Europe'),'Myanmar':('เมียนมา','MM','MMR','Asia'),
}
STOP_COUNTRY = {'Paris':'France','Strasbourg':'France','Munich':'Germany','Vienna':'Austria',
 'Copenhagen':'Denmark','Tokyo':'Japan','Kyoto':'Japan','Nagoya':'Japan'}

def place_of(r):
    ep, city, country, main = r['EP'], r['เมือง/พื้นที่'], r['ประเทศ'], r['สถานที่หลัก']
    if ep in MULTI:
        stops = [{'name':s,'lat':C[s][0],'lng':C[s][1]} for s in MULTI[ep]]
        return stops[0]['lat'], stops[0]['lng'], 'city', city.replace(';',' ·'), stops
    if main in P: return (*P[main], 'place', city, None)
    if city in C: return (*C[city], 'city', city, None)
    m = re.match(r'(.+?) \((city|multi-city|museum|zoo) ', city + ' ')
    if m and m.group(1) in C:
        key = m.group(1)
        return (*C[key], 'region' if key=='Europe' else 'country', key, None)
    if city.startswith('Finland'): return (*C['Finland'],'country','Finland',None)
    return None, None, 'none', city, None

eps, hubs = [], {}
def hub(name, lat, lng, country, kind):
    h = hubs.setdefault(name, {'name':name,'th':TH.get(name,name),'lat':lat,'lng':lng,
                               'country':country,'kind':kind})
    return name
for r in csv.DictReader(open(sys.argv[1], encoding='utf-8-sig')):
    lat, lng, prec, label, stops = place_of(r)
    country = r['ประเทศ']
    if stops:
        hub_names = [hub(st['name'], st['lat'], st['lng'], STOP_COUNTRY[st['name']], 'city') for st in stops]
    elif prec in ('place','city'):
        key = r['เมือง/พื้นที่'] if r['เมือง/พื้นที่'] in C else label
        hlat, hlng = C.get(key, (lat, lng))
        hub_names = [hub(key, hlat, hlng, country, 'city')]
    elif prec in ('country','region'):
        hub_names = [hub(label, lat, lng, country, prec)]
    else:
        hub_names = []
    vid = re.search(r'v=([\w-]{11})', r['YouTube URL'] or '')
    title = re.sub(r'^ไกลบ้าน EP\d+\s*', '', r['ชื่อวิดีโอ']).strip()
    eps.append({k:v for k,v in {
        'ep':int(r['EP']),'title':title,'city':r['เมือง/พื้นที่'],'country':r['ประเทศ'],
        'place':r['สถานที่หลัก'],'cat':r['หมวด'],'conf':r['ความมั่นใจ'],'status':r['สถานะวิดีโอ'],
        'len':r['ความยาว'],'vid':vid.group(1) if vid else None,'maps':r['Google Maps URL'],
        'note':r['หมายเหตุ'],'lat':lat,'lng':lng,'prec':prec,'label':label,'stops':stops,'hubs':hub_names,
    }.items() if v not in (None,'')})
sys.stdout.write('// Generated by scripts/build_data.py — do not edit by hand\nwindow.FAROSE_EPISODES = ')
json.dump(eps, sys.stdout, ensure_ascii=False, separators=(',',':'))
sys.stdout.write(';\n')
sys.stdout.write('window.FAROSE_HUBS = ')
json.dump(list(hubs.values()), sys.stdout, ensure_ascii=False, separators=(',',':'))
sys.stdout.write(';\nwindow.FAROSE_COUNTRIES = ')
json.dump({k:dict(zip(('th','iso2','a3','cont'),v)) for k,v in CTRY.items()}, sys.stdout, ensure_ascii=False, separators=(',',':'))
sys.stdout.write(';\n')
unmapped = [e['ep'] for e in eps if e['prec']=='none']
print(f'{len(eps)} episodes, unmapped: {unmapped}', file=sys.stderr)
