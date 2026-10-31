# Marathon The Hague 2026: road closures

One static page: the NN Marathon The Hague course on a map, with each of the 19 official road closures coloured by its state right now and a badge with the time left until it opens or closes. After the first visit it works fully offline (service worker, map tiles included). On iPhone, use Share → Add to Home Screen.

Live: https://djosh34.github.io/marathon_den_haag_tracker_2026/

- Closure times come from the official closure map on the [travel info page](https://nnmarathonthehague.nl/en/travel-info/). The course GPX files come from the [course page](https://nnmarathonthehague.nl/en/course/). The times are indicative.
- `tools/build_data.py` builds `data.js` from the GPX files and the closure list.
- Map tiles: a Protomaps extract (`map/hague.pmtiles`, zoom 0–14).
- Tap the clock to look at another time of race day (09:00 to 16:00) with a slider. "Back to live" returns to now.
- The Roads | Runner switch next to the clock changes the view. Runner hides the closures and shows, in orange, where a runner can be at the shown time, with km markers every 2.5. The start time and finish window are set in the sheet (default 10:15, finishing 14:00 to 14:30) and saved on the phone.
- To ship a change, bump `VERSION` in `sw.js`. Open phones get a "tap to update" banner.

## Test

```sh
python3 -m http.server 8642 --bind 127.0.0.1 &
podman run --rm --network host --ipc host -v "$PWD":/work:Z -w /work \
  mcr.microsoft.com/playwright:v1.64.1-noble node tools/test.mjs
```

The test runs Playwright WebKit with the `iPhone 17 Pro` profile. It writes screenshots at race-day times to `screenshots/`, checks the time-travel slider, the runner view (range, km markers, settings) and the location button, checks that a closure changes live, and reloads offline expecting zero network requests.
