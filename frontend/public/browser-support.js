// Blocking, same-origin check that runs before the app shell: a browser below
// the support matrix (the `browserslist` in frontend/package.json) gets an
// "Update your browser" notice in #root instead of an app that breaks part way.
// `apps/app/src/main.tsx` does not mount over it.
//
// The probes are the newest APIs the matrix admits: AbortSignal.any (Chrome
// and Edge 116, Safari 17.4, Samsung 24) and URL.canParse (Chrome and Edge 120,
// Samsung 25). Written in old syntax so the browsers it warns can run it.
(function () {
  var supported;
  try {
    supported = 'any' in AbortSignal && 'canParse' in URL;
  } catch (_error) {
    supported = false;
  }
  if (supported) return;
  document.documentElement.dataset.browserSupport = 'unsupported';
  var root = document.getElementById('root');
  if (!root) return;
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
