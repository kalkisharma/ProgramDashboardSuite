# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 4.x (current) | Yes — receives security fixes |
| 3.x and earlier | No — upgrade to 4.x |

---

## Security Model

This tool runs entirely in the browser. Understanding its security posture:

- **No server, no data transmission.** All processing happens locally on your machine. No Excel content, no project data, and no personal information is ever sent to any server.
- **No CDN calls at runtime.** SheetJS is bundled into `dist/index.html` at build time via Vite. The distributed single-file HTML has no runtime network dependencies — once on disk, no outbound requests are made.
- **HTML-escaped output.** All user-supplied Excel content is HTML-escaped before it is written into the page, preventing script execution from malicious cell values.
- **No authentication, no cookies.** The tool stores UI preferences in `localStorage` (theme, zoom levels, work days, column widths, collapsed phases, active filters). It also stores an **auto-save draft** (`vh-draft`) containing a full snapshot of the loaded project (tasks, specs, org chart, weight budget, project info) — written every 3 seconds after any edit and cleared on export. No data is transmitted; everything stays in the local browser. On shared machines, be aware that `localStorage` is accessible to any page on the same origin and persists until explicitly cleared or the draft is exported/dismissed.

---

## Deployment Considerations

For restricted or air-gapped environments:

- Distribute `dist/index.html` as a single self-contained file. No companion files or network access are required.
- The file can be placed on a shared network drive, a USB drive, or a local intranet server with no configuration changes.
- If your environment enforces a Content Security Policy via HTTP headers (e.g., when served from a web server rather than opened as a local file): the build output inlines all JavaScript as `<script>` blocks (no external `src`), so `script-src 'self'` alone is **not** sufficient. You need either `'unsafe-inline'` or a hash of the inlined script (the hash changes on every build). `style-src 'unsafe-inline'` is similarly required for inlined CSS.

---

## Reporting a Vulnerability

To report a security issue:

1. Open a GitHub issue titled `[SECURITY] <brief description>`.
2. Alternatively, contact the maintainer directly via the email on file.

Please include:
- A description of the vulnerability
- Steps to reproduce it
- The version of the tool affected
- The potential impact (what an attacker could achieve)

Response target: acknowledgement within 5 business days.

---

## Known Limitations

- **No Content Security Policy header when opened as a local file.** Browsers do not send HTTP headers for `file://` URLs, so a server-enforced CSP is only available when the tool is served via a web server. The tool does not rely on `eval` or remote scripts, so the practical risk is low.
- **Excel files from untrusted sources carry the same risk as any untrusted file.** While the tool HTML-escapes cell content before rendering, opening an Excel file from an unknown or hostile source should be treated with the same caution as opening any untrusted document.
- **The "today" marker is computed once at page load.** In long overnight sessions, the overdue indicators and work-day-remaining counts will reflect the date the page was loaded, not the current date. Reload the page to refresh them.
