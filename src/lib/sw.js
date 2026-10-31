// Registers the service worker. On the first visit it waits until the worker controls the page,
// so the big map file is downloaded only once (and then comes from the cache).
// `offer(worker)` is called when a new version is installed and waiting.
export async function serviceWorker(offer) {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  const reg = await navigator.serviceWorker.register('service-worker.js', { type: 'module' }).catch(() => null);
  if (!reg) return;
  if (hadController) {
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw.addEventListener('statechange', () => sw.state === 'installed' && offer(sw));
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    reg.update().catch(() => {});
    return;
  }
  const sw = reg.installing || reg.waiting || reg.active;
  await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    sw?.addEventListener('statechange', () => sw.state === 'redundant' && resolve());
  });
}
