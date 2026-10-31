<script>
  import '../app.css';
  import { onMount, tick } from 'svelte';
  import data from '../lib/data.js';
  import { status, color, left, hhmm, clock, DAY_START, DAY_END } from '../lib/time.js';
  import { DEFAULTS, TIMES, adjust, range, summary as runnerSummary, paceLine } from '../lib/runner.js';
  import { serviceWorker } from '../lib/sw.js';

  const stored = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };

  // Time travel: when `travel` is set, the whole page shows that moment instead of now.
  let live = $state(Date.now());
  let travel = $state(null);
  const now = $derived(travel ?? live);
  let mode = $state(stored('mode', 'roads') === 'runner' ? 'runner' : 'roads');
  let runner = $state({ ...DEFAULTS, ...stored('runner', {}) });
  let expanded = $state(false);
  let flash = $state(null);
  let update = $state(null); // a waiting service worker
  let map = $state.raw(null);
  let container;

  $effect(() => localStorage.setItem('mode', JSON.stringify(mode)));
  $effect(() => localStorage.setItem('runner', JSON.stringify(runner)));
  $effect(() => map?.update({ now, mode, runner: { ...runner } }));

  const rows = $derived(
    data.closures.map((c) => ({ c, st: status(c, now) })).sort((a, b) => a.st.next - b.st.next || a.c.n - b.c.n),
  );
  const closed = $derived(rows.filter((r) => r.st.state === 'closed').length);
  const upcoming = $derived(rows.find((r) => r.st.state !== 'done'));
  const where = $derived(range(runner, now));

  onMount(() => {
    const tickLive = () => (live = Date.now());
    const timer = setInterval(tickLive, 30e3);
    const visible = () => document.visibilityState === 'visible' && tickLive();
    document.addEventListener('visibilitychange', visible);
    (async () => {
      await serviceWorker((sw) => (update = sw));
      const { createMap } = await import('../lib/map.js');
      map = await createMap(container, { now, mode, runner: { ...runner } }, {
        onChunk: async (i) => {
          expanded = true;
          flash = i;
          await tick();
          document.querySelector(`#rows li[data-i="${i}"]`)?.scrollIntoView({ block: 'center' });
        },
      });
    })();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  });

  const toggleTravel = () => (travel = travel === null ? Math.min(Math.max(Date.now(), DAY_START), DAY_END) : null);
  // The 24h choices, plus a saved time that is not on the list.
  const options = (value) => (TIMES.includes(value) ? TIMES : [...TIMES, value].sort());
  const setRunner = (key) => (e) => (runner = adjust(runner, key, e.currentTarget.value));
  const pill = 'rounded-lg border-0 bg-ink text-white font-extrabold';
</script>

<!-- MapLibre's own CSS makes the map container position: relative, so a fixed wrapper places it. -->
<div class="fixed inset-0">
  <div bind:this={container} id="map" class="size-full"></div>
  {#if !map}<p id="loading" class="absolute inset-0 m-0 grid place-items-center text-muted">Loading the offline map</p>{/if}
</div>

<div class="fixed z-2 left-3 top-[calc(env(safe-area-inset-top)+10px)] flex items-center gap-2">
  <button
    id="clock"
    class="{pill} px-[11px] pt-1 pb-0.5 text-[22px]/[1.3] tracking-[0.02em] {travel !== null ? 'bg-sign' : ''}"
    aria-expanded={travel !== null}
    aria-controls="travel"
    aria-label="Clock. Tap to look at another time"
    onclick={toggleTravel}
  >{clock(now)} <span class="text-xs font-semibold tracking-normal opacity-70">{travel === null ? 'live' : 'preview'}</span></button>
  <div class="flex rounded-lg bg-ink p-[3px] text-sm font-bold" role="group" aria-label="View">
    {#each [['roads', 'Roads'], ['runner', 'Runner']] as [value, label] (value)}
      <button
        id="mode-{value}"
        class="rounded-md border-0 px-2.5 pt-1.5 pb-1 {mode === value ? 'bg-paper text-ink' : 'bg-transparent text-white/80'}"
        aria-pressed={mode === value}
        onclick={() => (mode = value)}
      >{label}</button>
    {/each}
  </div>
</div>

{#if travel !== null}
  <div id="travel" class="fixed z-2 inset-x-3 top-[calc(env(safe-area-inset-top)+56px)] flex items-center gap-2.5 rounded-xl bg-paper px-3 py-2.5 shadow-[0_2px_12px_rgb(29_34_38/0.2)]">
    <input
      id="slider"
      class="h-8 min-w-0 flex-1 accent-sign"
      type="range"
      aria-label="Time on race day"
      min={DAY_START}
      max={DAY_END}
      step={5 * 60e3}
      value={travel}
      oninput={(e) => (travel = Number(e.currentTarget.value))}
    />
    <button id="live" class="{pill} px-2.5 pt-2 pb-1.5 text-sm font-bold whitespace-nowrap" onclick={() => (travel = null)}>Back to live</button>
  </div>
{/if}

<section
  id="sheet"
  class="fixed z-3 inset-x-0 bottom-0 flex h-[62dvh] flex-col rounded-t-2xl bg-paper shadow-[0_-2px_14px_rgb(29_34_38/0.18)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
  style:transform={expanded ? 'translateY(0)' : 'translateY(calc(62dvh - var(--sheet-peek)))'}
  aria-label={mode === 'roads' ? 'Road closures' : 'Runner'}
>
  <button id="handle" class="grid border-0 bg-transparent px-4 pt-2 pb-2.5 text-left text-inherit" aria-expanded={expanded} aria-controls="details" onclick={() => (expanded = !expanded)}>
    <span class="mb-1.5 h-[5px] w-10 justify-self-center rounded-sm bg-[#c4c7c9]"></span>
    <strong id="summary" class="text-xl/[1.15] font-extrabold">
      {#if mode === 'runner'}{runnerSummary(where)}
      {:else}{closed ? `${closed} of ${rows.length} roads closed` : upcoming ? 'All roads open' : 'All roads reopened'}{/if}
    </strong>
    <span id="next" class="truncate text-[15px] text-muted">
      {#if mode === 'runner'}{paceLine(runner)}
      {:else}{upcoming ? `Next: ${upcoming.c.streets.split(' / ')[0]} ${upcoming.st.text} ${left(upcoming.st.next - now)}` : 'The marathon is over. Drive safe.'}{/if}
    </span>
  </button>
  <div id="details" class="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
    <div class="grid grid-cols-[26px_1fr_26px_1fr] items-center gap-x-2 gap-y-1.5 border-b border-[#d9dadb] pt-2.5 pb-3 text-[13px] text-muted">
      {#if mode === 'roads'}
        <span class="h-[7px] rounded-xs bg-closed"></span><span>closed</span>
        <span class="h-[7px] rounded-xs bg-[linear-gradient(90deg,#ff5a00,#ffb000,#3d8bd9,#1c4e8a)]"></span><span>open, closes in 0m to 4h</span>
        <span class="h-[7px] rounded-xs bg-gone"></span><span>reopened</span>
        <span class="h-[7px] rounded-xs bg-[repeating-linear-gradient(90deg,#8a7bb0_0_5px,transparent_5px_8px)]"></span><span>10K and 5K</span>
      {:else}
        <span class="h-[7px] rounded-xs bg-runner"></span><span>where the runner can be</span>
        <span class="h-[3px] rounded-xs bg-ink"></span><span>marathon course</span>
      {/if}
    </div>
    {#if mode === 'roads'}
      <ol id="rows">
        {#each rows as { c, st } (c.n)}
          {@const done = st.state === 'done'}
          <li
            data-i={c.n}
            class="grid cursor-pointer grid-cols-[8px_1fr_auto] items-center gap-x-3 border-b border-line py-[11px] {flash === c.n ? 'bg-[#fff3c4]' : ''}"
            class:done
            onclick={() => { expanded = false; map?.flyTo(c.label); }}
          >
            <span class="row-span-2 self-stretch rounded" style:background={color(st)}></span>
            <span class="streets text-[15px]/[1.25] {done ? 'font-semibold text-muted' : 'font-bold'}">{c.streets}</span>
            <span class="left row-span-2 text-right text-[19px] {done ? 'font-semibold text-muted' : 'font-extrabold'}">
              {#if done}<small class="block text-[11px] font-semibold text-muted">reopened</small>
              {:else}<small class="block text-[11px] font-semibold text-muted">{st.text}</small>{left(st.next - now)}{/if}
            </span>
            <span class="when text-[13px] text-muted">Closed {hhmm(c.close)} to {hhmm(c.open)}</span>
          </li>
        {/each}
      </ol>
      <p class="max-w-[60ch] text-xs text-muted">Sunday 1 November 2026. Times from the official closure map are indicative: a road can close earlier or reopen later.</p>
    {:else}
      <div class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 py-3 text-[15px] font-bold">
        {#each [['start', 'Start'], ['from', 'Finish from'], ['until', 'Finish until']] as [key, label] (key)}
          <label for="runner-{key}">{label}</label>
          <!-- A select, not <input type="time">, which shows AM/PM on phones set to 12h time. -->
          <select
            id="runner-{key}"
            class="rounded-lg border border-[#c4c7c9] bg-white px-2 py-1 font-sans text-[17px] tabular-nums"
            value={runner[key]}
            onchange={setRunner(key)}
          >
            {#each options(runner[key]) as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        {/each}
      </div>
      <p class="max-w-[60ch] text-xs text-muted">Assumes an even pace over the 42.195 km course: the back of the orange range is the slowest pace, the front the fastest. Saved on this phone.</p>
    {/if}
  </div>
</section>

{#if update}
  <button id="update" class="fixed z-4 inset-x-3 top-[calc(env(safe-area-inset-top)+118px)] rounded-[10px] border-0 bg-sign p-[13px] text-[15px] font-bold text-white" onclick={() => update.postMessage('skipWaiting')}>New version ready. Tap to update.</button>
{/if}
