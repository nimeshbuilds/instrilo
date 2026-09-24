(() => {
  const announcement = document.querySelector('#copy-announcement');
  for (const button of document.querySelectorAll('.copy-button')) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      const code = button.closest('.code-block')?.querySelector('code');
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = 'Copied';
        if (announcement) announcement.textContent = 'Commands copied to clipboard.';
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection?.removeAllRanges();
        selection?.addRange(range);
        button.textContent = 'Text selected';
        if (announcement) announcement.textContent = 'Commands selected. Use your device’s copy command.';
      }
      window.setTimeout(() => { button.textContent = 'Copy'; }, 2200);
    });
  }

  const tools = document.querySelector('.guide-tools');
  const search = document.querySelector('#guide-search');
  const cards = [...document.querySelectorAll('[data-scenario]')];
  if (!tools || !search || !cards.length) return;
  tools.hidden = false;
  let category = '';
  const buttons = [...document.querySelectorAll('[data-filter]')];
  const count = document.querySelector('#guide-count');
  const empty = document.querySelector('.empty-state');
  const update = () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      const visible = (!category || card.dataset.category === category) && words.every(word => card.dataset.search.includes(word));
      card.hidden = !visible;
      if (visible) shown++;
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.filter === category));
    if (count) count.textContent = `${shown} ${shown === 1 ? 'guide' : 'guides'}${shown === cards.length ? '' : ` of ${cards.length}`}`;
    if (empty) empty.hidden = shown !== 0;
  };
  search.addEventListener('input', update);
  for (const button of buttons) button.addEventListener('click', () => { category = button.dataset.filter; update(); });
  document.querySelector('[data-reset-search]')?.addEventListener('click', () => {
    category = '';
    search.value = '';
    update();
    search.focus();
  });
})();
