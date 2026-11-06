# ODI Bid Battle

ODI Bid Battle is a two-team auction app. Team members contribute gold to bid for candidates, while an operator manages bidding, confirms sales, and presents the final teams.

![Confirming a candidate sale in ODI Bid Battle](docs/preview/divan-satis.png)

## Run locally

### Requirements

- Git and Node.js **26.13.0** (includes npm).
- pnpm **12.16.1**, installed with the command below.
- Docker with Docker Compose: Docker Desktop on Windows (Linux containers), or Docker Engine with the Compose plugin on Linux. Start Docker before continuing.
- An SMTP account for registration and email verification. Google sign-in is optional; see [account configuration](docs/auth-deployment.md).

### Windows (PowerShell)

```powershell
git clone https://github.com/35HaRRy/odi-bid-battle.git
cd odi-bid-battle
npm install -g pnpm@12.16.1
pnpm install --frozen-lockfile
New-Item -ItemType Directory -Force db/data | Out-Null
notepad api/.env
```

Save the configuration shown below in `api/.env`, then run:

```powershell
pnpm dev
```

### Linux (Bash)

```bash
git clone https://github.com/35HaRRy/odi-bid-battle.git
cd odi-bid-battle
npm install -g pnpm@12.16.1
pnpm install --frozen-lockfile
mkdir -p db/data
nano api/.env
```

Save the configuration shown below in `api/.env`, then run:

```bash
pnpm dev
```

### Local configuration

Use your SMTP provider's settings in `api/.env`. Replace the example host, sender, username, and password; do not commit this file.

```dotenv
DATABASE_URL=postgres://bidbattle:bidbattle@localhost:5433/bidbattle
APP_URL=http://localhost:5173
ALLOWED_ORIGIN=http://localhost:5173
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_FROM=ODI Bid Battle <noreply@example.com>
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
```

This example uses STARTTLS on port 587. For implicit TLS, use port 465 and `SMTP_SECURE=true`. Without working SMTP, you can start the app, but cannot complete registration and email verification.

`pnpm dev` starts PostgreSQL, the API, and the frontend. If the API starts before PostgreSQL is ready on the first run, stop it with **Ctrl+C** and run `pnpm dev` again.

- Open **http://localhost:5173**.
- The API runs at **http://localhost:3001**; PostgreSQL uses port **5433**.
- Register, open the verification email, and sign in. You can switch the interface to English.
- A fresh database does not include the example content shown in the screenshots; create your own candidates, lists, and battlefields.

To stop the app, press **Ctrl+C**, then run `docker compose stop db`. Local database files remain in `db/data`.

**Updating an existing database:** back it up first, run `pnpm db:up`, wait until PostgreSQL is ready, then run `pnpm db:migrate` before `pnpm dev`. Restarting Docker does not apply schema updates. Do not delete `db/data` to fix migration issues.

## Application flow

### 1. Prepare an auction

Create candidates with names and images, arrange them in a candidate list, and create a battlefield. Create an auction, choose its list and battlefield, and configure two teams with flags, members, and starting gold. Give both teams equal total gold, review the setup, and start the auction.

### 2. Bid for candidates

The operator presents the next candidate. Enter each member's gold contribution and confirm the team's bid. Teams take turns bidding; each new bid must exceed the current confirmed bid.

![Team member contributions during a bidding round](docs/preview/divan-teklif.png)

### 3. Confirm the sale

Award the candidate to the team holding the latest confirmed bid. Confirm the sale to deduct that team's confirmed member contributions and add the candidate to its roster. Repeat for the remaining candidates.

### 4. Present the final teams

When the auction is complete, open the results to see both teams, their acquired candidates, and purchase prices. This presentation does not determine a battle winner.

![Completed auction showing both teams and their acquired candidates](docs/preview/savasin-sonucu-detay.png)

*Screenshots show an example auction using the Turkish interface.*
