# Kagaz documentation

Kagaz is a multi-shop print-order platform for Mandya: a customer uploads a PDF and pays on the
website, the shop's Windows app prints one packet (pages + pickup slip), and the customer collects
it with a daily pickup number. Start with the guide for your role.

## New team member: where to start

1. [PRD.md](PRD.md) §1–§6 — what we are building and the main journeys.
2. [decisions/ADR-002-daily-pickup-number.md](decisions/ADR-002-daily-pickup-number.md) — the
   current pickup and approval behaviour (overrides older PRD text).
3. Set up a shop: [guides/ADMIN_GUIDE.md §2](guides/ADMIN_GUIDE.md#2-set-up-a-new-shop-checklist)
   → [guides/SHOP_AGENT_INSTALL.md](guides/SHOP_AGENT_INSTALL.md) →
   [guides/OPERATOR_GUIDE.md](guides/OPERATOR_GUIDE.md).
4. Run the demo: [demo/DEMO_RUNBOOK.md](demo/DEMO_RUNBOOK.md).
5. Developers: the repository's `CLAUDE.md` (commands, invariants, conventions) and
   [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Product and plan

| Document                                                           | What it is                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [PRD.md](PRD.md)                                                   | Requirements, business rules, state models, data model, API, acceptance tests. |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)                   | Phases and stages (P0.1 … P5.7) with "Done when" criteria and algorithms.      |
| [architecture.png](architecture.png)                               | System diagram.                                                                |
| [contracts/PHASE2_5_CONTRACTS.md](contracts/PHASE2_5_CONTRACTS.md) | API/agent contracts shared by the Phase 2–5 workstreams.                       |

## Decisions

| Document                                                                             | Decision                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [decisions/ADR-001-merchant-of-record.md](decisions/ADR-001-merchant-of-record.md)   | Who receives the money (D6) — pending; live payments stay gated until decided.  |
| [decisions/ADR-002-daily-pickup-number.md](decisions/ADR-002-daily-pickup-number.md) | Daily pickup number, printing finished = ready, approval mode in shop Settings. |

## Guides (by role)

| Document                                                     | For                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [guides/CUSTOMER_GUIDE.md](guides/CUSTOMER_GUIDE.md)         | Customers: upload, options, price, demo payment, tracking, pickup number, sign-in, refunds. |
| [guides/OPERATOR_GUIDE.md](guides/OPERATOR_GUIDE.md)         | Shopkeepers: pairing, sign-in, printer setup, Auto/Manual, jobs, handover, needs check.     |
| [guides/ADMIN_GUIDE.md](guides/ADMIN_GUIDE.md)               | Kagaz team: shops, hours, pricing, devices, health, reconciliation, demo controls.          |
| [guides/SHOP_AGENT_INSTALL.md](guides/SHOP_AGENT_INSTALL.md) | Building, installing and updating the Windows shop app.                                     |

## Runbooks

| Document                                                         | Use when                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [runbooks/SUPPORT_RUNBOOK.md](runbooks/SUPPORT_RUNBOOK.md)       | A shop or customer calls: stuck jobs, needs check, refunds, re-pair, printers. |
| [runbooks/INCIDENT_CHECKLIST.md](runbooks/INCIDENT_CHECKLIST.md) | Something affects many orders, shops, money or data.                           |
| [runbooks/BACKUP_RESTORE.md](runbooks/BACKUP_RESTORE.md)         | Backing up and restoring Postgres; storage notes.                              |
| [runbooks/DEPLOYMENT.md](runbooks/DEPLOYMENT.md)                 | Building images, environments, releases, managed services.                     |
| [demo/DEMO_RUNBOOK.md](demo/DEMO_RUNBOOK.md)                     | Preparing and running the investor demo.                                       |

## Test reports

| Document                                                                               | What was tested                                                      |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [testing/p1-10-shop-app-virtual-printer.md](testing/p1-10-shop-app-virtual-printer.md) | P1.10 shop app end to end on a virtual printer.                      |
| [testing/T10-real-printer-canon-g2010.md](testing/T10-real-printer-canon-g2010.md)     | T10 real printer (Canon G2010) and the HP IPP class driver findings. |
| [testing/T18-load-run.md](testing/T18-load-run.md)                                     | T18 load run: 200 orders over 3 shops.                               |
| [testing/evidence/](testing/evidence/)                                                 | Screenshots and photos for the reports above.                        |
