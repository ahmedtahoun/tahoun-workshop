// Your social links. Add a URL to show that icon; leave '' to hide it.
window.SOCIAL = [
  { k: 'whatsapp',  label: 'WhatsApp',  url: 'https://wa.me/201288884313' },
  { k: 'linkedin',  label: 'LinkedIn',  url: 'https://www.linkedin.com/in/ah-ta' },
  { k: 'facebook',  label: 'Facebook',  url: '' },
  { k: 'instagram', label: 'Instagram', url: '' },
  { k: 'website',   label: 'Website',   url: 'https://tahoun.wheretospot.com/' }
];

// Simple line icons (24×24, drawn with the current text colour).
window.SOCIAL_ICONS = {
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c0 3.6 2.9 6.5 6.5 6.5l1-1.6-2-1-1 .9a4.6 4.6 0 0 1-2.3-2.3l.9-1-1-2z"/>',
  linkedin: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 10.5V17M8 7.5v.01M12 17v-6.5M12 13.2c0-1.6 1-2.7 2.4-2.7S16.5 11.5 16.5 13v4"/>',
  facebook: '<circle cx="12" cy="12" r="9"/><path d="M13.5 21v-7h2.3l.4-2.7h-2.7V9.6c0-.8.3-1.3 1.4-1.3h1.4V5.9a17 17 0 0 0-2-.1c-2 0-3.3 1.2-3.3 3.4v2.1H8.7V14H11v7"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>',
  website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'
};

// Fills every element with data-social with icon links.
(function () {
  function render() {
    var els = document.querySelectorAll('[data-social]');
    for (var i = 0; i < els.length; i++) {
      var box = els[i]; box.innerHTML = '';
      window.SOCIAL.forEach(function (s) {
        if (!s.url) return;
        var a = document.createElement('a');
        a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'soc'; a.setAttribute('aria-label', s.label); a.title = s.label;
        a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (window.SOCIAL_ICONS[s.k] || '') + '</svg>';
        box.appendChild(a);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
