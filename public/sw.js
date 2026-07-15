self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'EcoAlerta', {
    body: data.body || 'El camión recolector está cerca.',
    icon: '/ecoalerta-icon.svg',
    badge: '/ecoalerta-icon.svg',
    tag: data.tag || 'ecoalerta-proximity',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    return existing ? existing.focus() : clients.openWindow(event.notification.data?.url || '/');
  }));
});

