# Security notes

| Control | Implementation |
|---|---|
| Passwords | scrypt (per-user salt), min 10 chars, common-password and email-substring checks, forced change for admin-issued passwords |
| MFA | TOTP (RFC 6238) + 8 single-use recovery codes. **Required by default** for super admin, Member State admin and facility admin (`MFA_REQUIRED_ROLES`) |
| Sessions | HMAC-signed `HttpOnly; SameSite=Strict; Secure` cookie, 8 h absolute and 30 min idle lifetime, invalidated on password change |
| Brute force | Per-IP and per-account throttling and lockout on login and MFA |
| CSRF / XSS | Custom `X-Requested-With` header + Origin check; strict CSP (`script-src 'self'`, no inline scripts); all templates auto-escape |
| Encryption in transit | The app speaks HTTP to a reverse proxy; the supplied Caddy config terminates **TLS 1.3 only** with HSTS |
| Encryption at rest | AES-256-GCM field-level encryption of personal data (name, email, phone, certificate holder). Also enable full-disk/volume encryption on the host |
| Least privilege | RBAC enforced server-side on every route; tenant isolation is checked on every read and write; trainers see only their own drafts |
| Audit | Append-only, hash-chained log of authentication, administration, authoring and CEU events; `Audit & system` page verifies the chain |
| Privacy | Dashboards suppress groups under 5; public certificate verification shows a masked name |
| Quiz integrity | Marking is server-side; answer order is a seeded permutation; correct answers are never sent before submission |
| Data ownership | Per-tenant JSON/CSV export and learner self-export; SCORM 1.2 and xAPI for content/activity portability |

## Not included — decide before production

- **Web Application Firewall:** the ToR requires a WAF. None is bundled. Place the platform behind your data-centre WAF or add Coraza/ModSecurity (Caddy plugin) or a cloud WAF.
- **Penetration test and dependency review** by an independent party.
- **Secrets management:** use a vault or orchestrator secrets rather than a `.env` file; back up `DB_ENCRYPTION_KEY` separately from the database.
- **Email delivery:** there is no outbound email; administrators hand over temporary passwords securely. Add SMTP-based reset if required.
- **Monitoring/alerting** and log shipping (the server writes JSON access logs to stdout).

Report vulnerabilities privately to the maintainers of your deployment; do not open public issues for security problems.
