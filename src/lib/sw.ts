// Registers the service worker. On the first visit it waits until the worker controls the page,
// so the big map file is downloaded only once (and then comes from the cache).
// `offer(worker)` is called when a new version is installed and waiting.
export async function serviceWorker(offer: (worker: ServiceWorker) => void) {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const firstVisit = !sw.controller;
  const reg = await sw.register('service-worker.js', { type: 'module' }).catch(() => null);
  if (!reg) return;

  if (firstVisit) {
    const worker = reg.installing ?? reg.waiting ?? reg.active;
    await new Promise<void>((resolve) => {
      sw.addEventListener('controllerchange', () => resolve(), { once: true });
      worker?.addEventListener('statechange', () => worker.state === 'redundant' && resolve());
    });
    return;
  }

  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing!;
    worker.addEventListener('statechange', () => worker.state === 'installed' && offer(worker));
  });
  sw.addEventListener('controllerchange', () => location.reload());
  reg.update().catch(() => {});
}
