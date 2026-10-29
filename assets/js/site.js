(() => {
  const root = document.documentElement;
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  // Theme: follows the OS until the visitor picks one with the toggle.
  const currentTheme = () => root.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
  const announce = () => document.dispatchEvent(new CustomEvent('themechange'));

  document.querySelector('.theme-toggle')?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
    announce();
  });
  darkQuery.addEventListener('change', () => { if (!root.dataset.theme) announce(); });

  // BibTeX: show/hide the block, and copy it to the clipboard.
  document.querySelectorAll('[data-bib]').forEach((button) => {
    const box = document.getElementById(button.getAttribute('aria-controls'));
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      box.hidden = open;
    });
  });

  document.querySelectorAll('.copy').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.nextElementSibling.textContent);
        button.textContent = 'copied';
      } catch (e) {
        button.textContent = 'press ctrl+c';
      }
      setTimeout(() => { button.textContent = 'copy'; }, 1500);
    });
  });
})();
