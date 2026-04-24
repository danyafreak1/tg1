const jobList = document.getElementById('job-list');

function renderSticker(sticker) {
  const date = sticker.addedAt ? new Date(sticker.addedAt).toLocaleString() : '';
  return `
    <article class="job-item">
      <p><strong>${sticker.sourceOriginalName || sticker.fileId}</strong></p>
      <p>${sticker.setTitle || sticker.setName}</p>
      ${date ? `<p class="muted">${date}</p>` : ''}
      <p><a href="${sticker.addUrl}" target="_blank" rel="noreferrer">Open set</a></p>
    </article>
  `;
}

async function refreshStickers() {
  const response = await fetch('/api/stickers/recent');
  const data = await response.json();
  jobList.innerHTML = data.stickers.map(renderSticker).join('') || '<p>No stickers yet.</p>';
}

refreshStickers();
setInterval(refreshStickers, 15000);
