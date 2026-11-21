(function () {
  var supported;
  try {
    supported =
      'any' in AbortSignal &&
      'canParse' in URL &&
      CSS.supports('color', 'light-dark(canvas, canvastext)');
  } catch (_error) {
    supported = false;
  }
  if (supported) return;
  document.documentElement.dataset.browserSupport = 'unsupported';
  var root = document.getElementById('root');
  if (!root) return;
  root.textContent = '';
  var notice = document.createElement('main');
  notice.style.maxWidth = '32rem';
  notice.style.margin = '20vh auto 0';
  notice.style.padding = '0 1.5rem';
  notice.style.fontFamily = 'system-ui, sans-serif';
  notice.style.lineHeight = '1.5';
  var heading = document.createElement('h1');
  heading.style.fontSize = '1.5rem';
  heading.textContent = 'Update your browser';
  var body = document.createElement('p');
  body.textContent =
    'CiteLadder needs a newer browser. Update Chrome, Edge, Firefox, Safari or Samsung Internet to the latest version, then reload this page.';
  notice.appendChild(heading);
  notice.appendChild(body);
  root.appendChild(notice);
})();
