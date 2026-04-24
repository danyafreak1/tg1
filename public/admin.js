const tokenInput = document.getElementById('admin-token');
const saveTokenButton = document.getElementById('save-token');
const refreshButton = document.getElementById('refresh-admin');
const searchQueryInput = document.getElementById('search-query');
const adminList = document.getElementById('admin-list');
const adminError = document.getElementById('admin-error');

const STORAGE_KEY = 'sticker-admin-token';
let adminItems = [];

function getToken() {
  return tokenInput.value.trim();
}

function setError(message) {
  adminError.textContent = message;
  adminError.classList.remove('hidden');
}

function clearError() {
  adminError.textContent = '';
  adminError.classList.add('hidden');
}

function apiHeaders() {
  const token = getToken();
  return token ? { 'x-admin-token': token } : {};
}

function normalizeQuery(value) {
  return value.trim().toLowerCase();
}

function renderSticker(sticker) {
  return `
    <div class="sticker-row">
      ${sticker.thumbnailUrl ? `<img class="sticker-thumb" src="${sticker.thumbnailUrl}" alt="Sticker preview" loading="lazy" />` : ''}
      <div>
        <p><strong>${sticker.emoji}</strong> ${sticker.width}x${sticker.height} ${sticker.isVideo ? 'video' : ''}</p>
        ${sticker.sourceOriginalName ? `<p class="muted"><span class="search-hit">${sticker.sourceOriginalName}</span></p>` : ''}
      </div>
      <button class="danger-button" data-action="delete-sticker" data-file-id="${sticker.fileId}">Delete sticker</button>
    </div>
  `;
}

function renderSet(item) {
  const { set, stickers } = item;
  const stickersHtml = stickers.length
    ? `<div class="sticker-grid">${stickers.map(renderSticker).join('')}</div>`
    : `<p class="muted">${set.error || 'No live stickers returned by Telegram.'}</p>`;

  return `
    <article class="set-card">
      <div class="set-head">
        <div>
          <h2>${set.title || set.name}</h2>
          <p class="muted">${set.stickerCount} stickers</p>
          <p><a href="${set.addUrl}" target="_blank" rel="noreferrer">${set.addUrl}</a></p>
        </div>
        <button class="danger-button" data-action="delete-set" data-set-name="${set.name}">Delete set</button>
      </div>
      ${stickersHtml}
    </article>
  `;
}

function matchesQuery(item, query) {
  if (!query) {
    return true;
  }

  const setFields = [
    item.set.title,
    item.set.name
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (setFields.includes(query)) {
    return true;
  }

  return item.stickers.some((sticker) =>
    [sticker.sourceOriginalName, sticker.fileId, sticker.uniqueId]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  );
}

function renderAdminList() {
  const query = normalizeQuery(searchQueryInput.value || '');
  const filteredItems = adminItems
    .map((item) => ({
      ...item,
      stickers: query
        ? item.stickers.filter((sticker) =>
            [sticker.sourceOriginalName, sticker.fileId, sticker.uniqueId]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(query)
          )
        : item.stickers
    }))
    .filter((item) => matchesQuery(item, query));

  adminList.innerHTML = filteredItems.map(renderSet).join('') || '<p>No sticker sets tracked yet.</p>';
}

async function loadAdmin() {
  clearError();

  const response = await fetch('/api/admin/stickers', {
    headers: apiHeaders()
  });
  const data = await response.json();

  if (!response.ok) {
    setError(data.error?.message || 'Failed to load admin sticker registry.');
    adminList.innerHTML = '';
    return;
  }

  adminItems = data.items;
  renderAdminList();
}

async function deleteSticker(fileId) {
  const response = await fetch(`/api/admin/stickers/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: apiHeaders()
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to delete sticker.');
  }
}

async function deleteSet(setName) {
  const response = await fetch(`/api/admin/sets/${encodeURIComponent(setName)}`, {
    method: 'DELETE',
    headers: apiHeaders()
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to delete set.');
  }
}

saveTokenButton.addEventListener('click', () => {
  localStorage.setItem(STORAGE_KEY, getToken());
  loadAdmin();
});

refreshButton.addEventListener('click', loadAdmin);
searchQueryInput.addEventListener('input', renderAdminList);

adminList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  try {
    if (button.dataset.action === 'delete-sticker') {
      if (!confirm('Delete this sticker from its set?')) {
        return;
      }
      await deleteSticker(button.dataset.fileId);
    }

    if (button.dataset.action === 'delete-set') {
      if (!confirm('Delete the whole sticker set?')) {
        return;
      }
      await deleteSet(button.dataset.setName);
    }

    await loadAdmin();
  } catch (error) {
    setError(error.message);
  }
});

tokenInput.value = localStorage.getItem(STORAGE_KEY) || '';
loadAdmin();
