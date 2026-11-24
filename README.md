# Africa CDC Digital Literacy Learning Platform

An open-source, self-hosted, multi-tenant learning platform for the African public health workforce, built from the Africa CDC / PHAS Terms of Reference (V2.0 Draft). It ships **ready to use**: a complete starter curriculum of **21 modules (30 CEU) in English and French**, a 150-question quiz bank, a 40-question certification exam, QR-verifiable certificates, a CEU ledger, authoring and review workflow, and continental/Member-State dashboards.

- **Licence:** Apache-2.0 — no per-user fees, no lock-in, full open-format export.
- **Zero runtime dependencies:** Node.js ≥ 22.5 only (uses built-in SQLite). No `npm install` needed.
- **Two ways to run it** (read this — they are not the same thing):

| | **Demo mode** | **Server mode (real deployment)** |
|---|---|---|
| How | Open the GitHub Pages site or any static host | `node server/index.js` or Docker |
| Data | Synthetic, stored **only in your browser** | Real, in an encrypted SQLite database on your server |
| Sign-in | Pick a persona | Email + password (+ MFA for administrators) |
| Shared between users | No | Yes |
| Use for | Presentations, evaluation, training the trainers | Pilot and production |

> **Demo mode is not a production system.** Anyone using a demo site only sees their own browser's data.

## Quick start (server)

```bash
node scripts/build-content.js            # (optional) regenerate curriculum JSON from /content
ADMIN_EMAIL=you@africacdc.org ADMIN_PASSWORD='ChangeMe-2026!' ALLOW_LOCAL_KEYS=1 node server/index.js
# open http://localhost:8080 — you must enrol an authenticator app and change the password at first sign-in
```

Add `DEMO_DATA=1` to preload synthetic Member States and learners for a staging/training server. For production use Docker and real secrets: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## What is in the box

| Area | Details |
|---|---|
| **Starter curriculum** | 4 levels, 21 modules, 65+ lessons, activities, job aids, 150 quiz items — EN + FR. See [docs/CURRICULUM.md](docs/CURRICULUM.md) |
| **Multi-tenant** | 55 Member State spaces + the Africa CDC space, strictly isolated; pilots flagged (Mauritania, CAR, Burundi) |
| **Roles** | Africa CDC super admin · Member State admin · facility admin · trainer/author · learner |
| **Assessment** | Per-module quiz (pass 70%, 3 attempts then trainer unlock), 40-question final exam (60 min), server-side marking, answer keys never sent to the browser |
| **Certificates** | `ACDC-XXXX-XXXX-XXXX` codes, HMAC-signed, QR to a public verification page, accredited vs Member-State-issued, 2-year validity, masked holder name |
| **CEU ledger** | Automatic awards, external-learning claims with approval, renewal target 6 CEU / 2 years |
| **Authoring** | Bilingual editor → Draft → Review (four-eyes, 4-point checklist) → Publish → private / share with named partners / submit to Africa CDC library; SCORM 1.2 export; xAPI statements |
| **Dashboards** | Member-State ranking (enrolment + utilization), coverage map (continental tile map + facility GPS map), demographics by sex / age / facility type / profession with small-cell suppression |
| **Offline / mobile** | Mobile-first UI, installable PWA, offline course download, outbox sync with idempotent replay |
| **Security** | scrypt password hashing, TOTP MFA + recovery codes, rate-limiting/lockout, AES-256-GCM encryption of personal fields, hash-chained audit log, CSP without inline scripts, CSRF header + Origin checks |
| **Languages** | EN, FR now; add PT/AR by dropping a JSON file ([docs/ADDING_A_LANGUAGE.md](docs/ADDING_A_LANGUAGE.md)); RTL supported |

## Documentation

- [Compliance matrix vs the ToR](docs/COMPLIANCE_MATRIX.md) — requirement-by-requirement status, **including honest gaps**
- [Deployment guide](docs/DEPLOYMENT.md) · [Security notes](docs/SECURITY.md) · [Adding a language](docs/ADDING_A_LANGUAGE.md) · [Curriculum](docs/CURRICULUM.md)

## Develop and test

```bash
npm test                 # 23 backend/unit/integration tests (node:test)
npm run check:i18n       # locale key coverage (EN/FR)
npm run ui:test          # Playwright UI flows (needs Playwright + a static server on :8099 for flows.mjs)
```

## Honest status

This is a complete, tested, working platform — **not** an independently audited production system. Before go-live with real learners, Africa CDC should commission: a penetration test, load testing at expected scale, a data-protection impact assessment, subject-matter expert review of curriculum content (especially clinical-adjacent and DHIS2/REDCap modules), and native-speaker review of the French text. See the gaps listed in the compliance matrix.
