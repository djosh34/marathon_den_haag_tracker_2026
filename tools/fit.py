# One-off: find where each closure arrow of the official closure image lands on the GPX course.
import re, math, json, sys
import numpy as np

def load(f):
    return [tuple(map(float, m)) for m in re.findall(r'lat="([\d.]+)" lon="([\d.]+)"', open(f).read())]

def cum_km(pts):
    out = [0.0]
    for a, b in zip(pts, pts[1:]):
        out.append(out[-1] + math.hypot((b[0]-a[0])*111.2, (b[1]-a[1])*111.2*math.cos(math.radians(52.05))))
    return out

pts = load('tools/NN-Marathon-The-Hague-DEF.gpx')
km = cum_km(pts)

def at_km(k):
    for i in range(1, len(km)):
        if km[i] >= k:
            t = (k-km[i-1])/(km[i]-km[i-1])
            a, b = pts[i-1], pts[i]
            return (a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
    return pts[-1]

# km markers in the closure image (pixel coords of the 2000px-wide rendering)
marks = {0: (1655, 343), 5: (1493, 620), 10: (1330, 935), 15: (1120, 1160), 20: (893, 1040),
         25: (842, 815), 30: (1080, 512), 35: (1255, 258), 40: (1548, 140)}
A = np.array([[at_km(k)[1], at_km(k)[0], 1] for k in marks])
P = np.array(list(marks.values()), dtype=float)
M, res, *_ = np.linalg.lstsq(A, P, rcond=None)
pred = A @ M
print('fit error px:', np.round(np.hypot(*(pred-P).T), 1), file=sys.stderr)
Minv = np.linalg.pinv(np.vstack([M.T, [0, 0, 1]]))

def px_to_km(x, y, route_pts, route_km):
    lon, lat, _ = Minv @ np.array([x, y, 1])
    best = min(range(len(route_pts)), key=lambda i: (route_pts[i][0]-lat)**2 + ((route_pts[i][1]-lon)*0.615)**2)
    return round(route_km[best], 2), (lat, lon)

tips = {1: [(1480, 390), (1556, 352)], 2: [(1465, 425), (1475, 550)], 3: [(1475, 640), (1355, 805)],
        4: [(1210, 1000), (1325, 965), (1235, 1140)], 5: [(1080, 1175)], 6: [(940, 1110), (935, 1205)],
        7: [(838, 1025)], 8: [(755, 875), (690, 1010)], 9: [(1025, 658), (995, 735)], 10: [(1015, 572)],
        11: [(1048, 505)], 12: [(1150, 430), (1190, 385), (1210, 355)], 13: [(1235, 270), (1335, 175)],
        14: [(1345, 105)], 15: [(1510, 95)], 16: [(1575, 165)], 17: [(1612, 289)]}
for n, ts in tips.items():
    print(n, [px_to_km(x, y, pts, km)[0] for x, y in ts])
print('total', round(km[-1], 2))
p10 = load('tools/NN-The-Hague-10K-DEF.gpx'); k10 = cum_km(p10)
print(18, px_to_km(1440, 160, p10, k10), 'of', round(k10[-1], 2))
print(0, px_to_km(1680, 325, pts, km))
