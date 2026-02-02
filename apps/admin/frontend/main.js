const status = document.querySelector('.status');
const now = new Date();

if (status) {
  status.textContent = `Window loaded • ${now.toLocaleTimeString()}`;
}
