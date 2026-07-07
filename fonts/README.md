# Vendored UI display font

Self-hosted (same-origin) so the cinematic display type works without any
third-party font CDN — matching the self-hosted encoder philosophy.

- `oswald-500.woff2`, `oswald-700.woff2` — Oswald (semi-condensed grotesque),
  latin subset, from @fontsource/oswald 5.x. Used for headings, the wordmark,
  section labels and the transport time. UI falls back to a system condensed
  stack if these ever fail to load.
