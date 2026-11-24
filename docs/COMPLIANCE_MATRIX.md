# Compliance matrix — ToR V2.0 (Draft) vs this release

Legend: ✅ delivered and tested · 🟡 partly delivered / needs deployment action · ❌ not delivered

| ID | Requirement (summary) | Status | How it is met / what is missing |
|---|---|---|---|
| FRS01 | Self-hosted open-source LMS, no per-user licence fees | ✅ | Apache-2.0, Node + SQLite, no external services. **Deviation:** the ToR *recommends* Moodle "or an equivalent"; this is a purpose-built platform, not Moodle. Africa CDC must accept this as the "equivalent" or treat it as a deviation |
| FRS02 | Multi-tenant Member State spaces, isolated | ✅ | 55 tenants + Africa CDC; tenant checks on every route (tested in `core.test.js`, `server.test.js`) |
| FRS03 | RBAC: Africa CDC super admins, MS admins, facility/sub-national admins, trainers/authors, learners | ✅ | Five roles, server-enforced; facilities/regions modelled; CSV user import; cohorts |
| FRS04 | Authoring workflow Draft→Review→Publish; private / share with named partners / submit to continental library | ✅ | Four-eyes rule and 4-point review checklist; super-admin promote/return; versioning via "new version" |
| FRS05 | Quiz engine, SCORM/xAPI, QR-verifiable certificates (accredited vs Member State), CEU ledger | ✅ | Native quiz engine; SCORM 1.2 **export**; xAPI statements + inbound endpoint. **Not done:** SCORM *import/player* for third-party packages; xAPI forwarding to an external LRS is documented, not automated |
| FRS06 | Mobile-first, offline lesson download and sync | 🟡 | Responsive PWA, offline course packages, outbox sync with idempotent replay, tested with a simulated offline mode. **Not tested** on low-end Android devices or real 2G networks; exam requires connectivity by design |
| FRS07 | TLS 1.3, encryption at rest, WAF, audit logging, least privilege, MFA for admins | 🟡 | TLS 1.3 via supplied Caddy config; field-level AES-256-GCM at rest (+ disk encryption advised); hash-chained audit log; MFA enforced for admins; least privilege. **WAF is not included** — must be provided by the data centre or added. No penetration test performed |
| FRS08 | EN/FR now, PT/AR (RTL) later, WCAG 2.1 AA | 🟡 | EN + FR complete; locale framework + RTL ready. WCAG: semantic landmarks, skip link, focus management, labelled controls, text equivalents for charts/maps, colour-independent status, reduced-motion support — **no formal WCAG audit or screen-reader test was performed** |
| — | Data ownership, portability, no lock-in | ✅ | Full JSON export per tenant, CSV exports, learner self-export, SCORM export |
| — | Pilot Mauritania, CAR, Burundi | 🟡 | Tenants flagged as pilots and seeded with synthetic demo data only. Actual pilot onboarding, training and support are people-activities outside this software |
| — | Hosting at Africa CDC data centre | 🟡 | Docker/compose provided; deployment and operations are Africa CDC's |
| — | Integrations (DHIS2, REDCap, etc.) | n/a | Out of scope per ToR; training modules on these tools teach concepts only |
| — | Other languages | n/a | Out of scope per ToR |
| — | Starter content "ready for Member States" | 🟡 | 21 modules, 150 quiz items, exam, EN+FR delivered. Requires Africa CDC subject-matter and native-speaker review before use with learners |
| — | Documentation and training materials | 🟡 | Deployment, security, curriculum and language guides included; in-app job aids. No separate video/training-of-trainers package |
| — | Performance / scalability / availability SLAs | ❌ | Not load-tested; single-node design. See `docs/DEPLOYMENT.md` §4 |

## Verification performed

- 23 automated tests (core logic and secured HTTP server): isolation, scoring, lockout, exam expiry, certificate signing and tamper detection, CEU idempotency, authoring workflow, audit-chain tamper detection, offline sync replay, MFA, session expiry.
- Browser flows (Playwright): learner completes a module and passes the quiz; trainer→admin authoring and sharing across Member States; FR switch; mobile layout; offline mode; public certificate verification; real-server login with MFA enrolment and forced password change.
- i18n key coverage check (`npm run check:i18n`).
