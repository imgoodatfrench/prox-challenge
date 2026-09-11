// Builds the `srcdoc` for the sandboxed artifact iframe.
//
// Security model:
//  - The iframe is mounted with sandbox="allow-scripts" ONLY (no
//    allow-same-origin) → opaque origin, no access to parent DOM/cookies/storage.
//  - A CSP <meta> restricts sources to the cdnjs CDN and inline scripts, and
//    sets connect-src 'none' so a generated artifact cannot exfiltrate data.
//  - A postMessage bridge reports content height (auto-resize) and runtime
//    errors back to the parent, which validates event.source === iframe.
//
// Runtimes:
//  - "react": `code` defines a component named `App` (JSX allowed); we transform
//    it with Babel-standalone in-browser and mount it.
//  - "html": `code` is an HTML fragment injected into <body> (scripts run).

export type ArtifactRuntime = "react" | "html";

// Pinned CDN builds (cdnjs is the artifact CDN allowlist). Swap versions here.
const REACT = "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js";
const REACT_DOM = "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js";
const BABEL = "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js";

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com",
  "style-src 'unsafe-inline'",
  "img-src data: https:",
  "font-src https: data:",
  "connect-src 'none'",
].join("; ");

// Bridge injected into every artifact: reports height + errors to the parent.
const BRIDGE = `
  (function () {
    function post(msg) { try { parent.postMessage(msg, '*'); } catch (e) {} }
    var lastH = 0;
    function height() {
      var h = Math.ceil(Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      ));
      if (h && h !== lastH) { lastH = h; post({ type: 'artifact-height', height: h }); }
    }
    window.__artifactHeight = height;
    window.addEventListener('error', function (e) {
      post({ type: 'artifact-error', message: (e && e.message) || 'Script error' });
    });
    window.addEventListener('unhandledrejection', function (e) {
      post({ type: 'artifact-error', message: 'Unhandled promise rejection: ' + (e && e.reason) });
    });
    window.addEventListener('load', height);
    if (window.ResizeObserver) {
      new ResizeObserver(height).observe(document.documentElement);
    } else {
      setInterval(height, 500);
    }
  })();
`;

function reactBody(code: string): string {
  return `
  <div id="root"></div>
  <script src="${REACT}" crossorigin onerror="parent.postMessage({type:'artifact-error',message:'Failed to load React'}, '*')"></script>
  <script src="${REACT_DOM}" crossorigin onerror="parent.postMessage({type:'artifact-error',message:'Failed to load ReactDOM'}, '*')"></script>
  <script src="${BABEL}" crossorigin onerror="parent.postMessage({type:'artifact-error',message:'Failed to load Babel'}, '*')"></script>
  <script>${BRIDGE}</script>
  <script type="text/babel" data-presets="react">
    try {
      const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;
      ${code}
      const __root = ReactDOM.createRoot(document.getElementById('root'));
      __root.render(React.createElement(typeof App !== 'undefined' ? App : function () {
        return React.createElement('div', { style: { color: '#b00' } },
          'Artifact did not define a component named "App".');
      }));
      setTimeout(function () { if (window.__artifactHeight) window.__artifactHeight(); }, 60);
    } catch (err) {
      parent.postMessage({ type: 'artifact-error', message: String(err && err.message || err) }, '*');
    }
  </script>`;
}

function htmlBody(code: string): string {
  return `
  <script>${BRIDGE}</script>
  ${code}
  <script>setTimeout(function(){ if (window.__artifactHeight) window.__artifactHeight(); }, 60);</script>`;
}

export function buildArtifactSrcDoc(code: string, runtime: ArtifactRuntime): string {
  const body = runtime === "html" ? htmlBody(code) : reactBody(code);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; padding: 12px; }
  button { cursor: pointer; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
