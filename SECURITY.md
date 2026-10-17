# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
GitHub: **Security → Report a vulnerability** on
[the repository](https://github.com/abhij1306/CiteLadder/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge
reports within a few days and will keep you updated until a fix is released.

## Supported versions

Security fixes land on `main`. Run the latest `main` (or the latest release, once releases are
published).

## Deployment notes

CiteLadder is built to be self-hosted by a single team and **has no login**: anyone who can reach
the app port can use the workspace, its stored provider keys and its connected integrations.

- The default Compose file publishes the app on `127.0.0.1` only. Keep it that way, or put an
  authenticating reverse proxy (for example oauth2-proxy, Cloudflare Access or Tailscale) in
  front of it before exposing it to a network.
- Instance secrets (`ENCRYPTION_KEY`, `API_KEY_PEPPER`, …) are generated on first start and
  stored in the `citeladder_data` volume. Back that volume up with the database: provider
  credentials cannot be decrypted without it.
- Set a strong `MCP_TOKEN` if you enable the MCP endpoint, and treat it like a password.
- Change the default PostgreSQL password if the database is reachable from anywhere but the
  Compose network.
