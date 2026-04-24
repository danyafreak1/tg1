const statusNode = document.querySelector('#payment-status');
const userChipNode = document.querySelector('#user-chip');
const payButtons = Array.from(document.querySelectorAll('.pay-button'));

const url = new URL(window.location.href);
const userId = url.searchParams.get('user_id') || 'unknown';

userChipNode.textContent = `User: ${userId}`;

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}

for (const button of payButtons) {
  button.addEventListener('click', () => {
    const plan = button.dataset.plan || 'custom';
    const price = button.dataset.price || '$0.00';
    statusNode.textContent = `Stub payment successful: ${plan} plan for ${price}. Next step is wiring a real provider.`;

    if (window.Telegram?.WebApp?.showAlert) {
      window.Telegram.WebApp.showAlert(`Stub payment: ${plan} ${price}`);
    }
  });
}
