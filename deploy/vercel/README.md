# Omnigent on Vercel

Run the Omnigent server as a **Vercel container function**: Vercel builds the
one-line `Dockerfile.vercel` shim at the repo root (it pulls the prebuilt
`ghcr.io/omnigent-ai/omnigent-server` image), serves it over HTTPS on
`*.vercel.app`, and scales it on Fluid compute. Postgres comes from the Neon
marketplace integration; durable artifacts go to any S3-compatible bucket.

> [!NOTE]
> **Know the tradeoffs before picking this target.** Vercel's WebSocket
> support (public beta) closes every connection when the function hits its
> max duration — **300 s on Hobby, 800 s on Pro** (1800 s beta). Omnigent's
> runner and host tunnels auto-reconnect in ~0.5 s and in-flight turns
> survive the cut, so sessions keep working — but the tunnels churn every
> few minutes, and a request that is mid-flight over the tunnel at the
> instant of the cut fails once. Vercel also has no persistent disk and no
> way to pin traffic to one instance (see [Constraints](#constraints)).
> For an always-on tunnel with no churn, use Render, Railway, Fly, or Modal
> instead. This target suits kicking the tires and light single-user use.

## How it works

```
        HTTPS / SSE / WebSocket
browser ───────────────►  Vercel (Fluid compute)
runner  ───────────────►      │ container function
                              ▼
                        omnigent server ──► DATABASE_URL (Neon Postgres,
                        (Dockerfile.vercel │  marketplace integration)
                         → prebuilt image) │
                                           └► OMNIGENT_ARTIFACT_URI
                                              s3://… (optional, durable)
```

- **`Dockerfile.vercel`** (repo root) — auto-detected by Vercel; the image is
  built on Vercel's builders (no local Docker) and pushed to Vercel's
  registry. It's a `FROM ghcr.io/omnigent-ai/omnigent-server` shim, so the
  deploy runs the exact same entrypoint as every other container platform.
- **Neon Postgres** — provisioned through the Vercel marketplace;
  `DATABASE_URL` is injected automatically.
- **S3-compatible bucket** (optional but recommended) — the container's disk
  is ephemeral, so agent bundles and user files only survive instance
  recycling when `OMNIGENT_ARTIFACT_URI` points at a bucket (AWS S3,
  Cloudflare R2, …) via the native `S3ArtifactStore`.

## Prerequisites

- A Vercel account with **Fluid compute** (the default for projects created
  since April 2025). WebSocket support is a public beta; the Hobby plan
  works, Pro raises the tunnel-cut interval from 300 s to 800 s.
- **Node** for the `vercel` CLI (`npx vercel …`); no local Docker needed.

## Deploy

### 1. Create the project

From the repo root (a clone or your fork):

```bash
npx vercel login
npx vercel deploy          # creates + links the project; picks up Dockerfile.vercel
```

The first deploy fails to boot without a database — that's expected; keep
going.

### 2. Provision Neon Postgres

```bash
npx vercel install neon    # marketplace integration; injects DATABASE_URL
```

(Or from the dashboard: **Storage → Create Database → Neon**, connected to
the project.) The entrypoint normalizes Neon's `postgres://` URL
automatically.

### 3. Set the required env vars

```bash
# Session cookie secret — pin it: the disk is ephemeral, and a re-minted
# secret would log everyone out on every instance recycle.
openssl rand -hex 32 | npx vercel env add OMNIGENT_ACCOUNTS_COOKIE_SECRET production
```

The public base URL is auto-detected from Vercel's
`VERCEL_PROJECT_PRODUCTION_URL`, so it needs no manual set.

### 4. Deploy to production

```bash
npx vercel deploy --prod
```

The **first** boot runs all migrations against Neon before the server
listens (~1 minute), so the first few requests may 5xx or time out while it
migrates — just retry. Later cold starts are a few seconds.

```bash
curl https://<project>.vercel.app/health   # {"status":"ok"}
```

### 5. First admin + connect a host

Open the URL — the Setup screen claims the first admin (username +
password). Then connect a machine to actually run agents (the server is just
the control plane):

```bash
omnigent login https://<project>.vercel.app
omnigent host  --server https://<project>.vercel.app
```

## Durable artifacts (recommended)

Without this, uploaded agents and files vanish whenever Vercel recycles the
instance (it scales in after ~5 idle minutes). Point the artifact store at
any S3-compatible bucket:

```bash
npx vercel env add OMNIGENT_ARTIFACT_URI production      # s3://<bucket>[/prefix]
npx vercel env add AWS_ACCESS_KEY_ID production
npx vercel env add AWS_SECRET_ACCESS_KEY production
npx vercel env add AWS_ENDPOINT_URL_S3 production        # non-AWS only (e.g. R2)
```

For Cloudflare R2 credentials, see the walkthrough in
[`../cloudflare/README.md`](../cloudflare/README.md#4-r2-s3-credentials-for-the-artifact-store);
the store and env vars are identical here.

## Raise the tunnel-cut interval (Pro)

On Hobby, function max duration is fixed at 300 s, so runner/host tunnels
reconnect every 5 minutes. On Pro, raise the project's default function max
duration to **800 s** in the dashboard (**Settings → Functions**) to cut the
churn to ~13-minute cycles. Reconnects are automatic either way.

## Use your own IdP instead (OIDC)

Switch the provider with env vars (OIDC requires HTTPS, which `*.vercel.app`
provides):

```bash
npx vercel env add OMNIGENT_AUTH_PROVIDER production        # oidc
npx vercel env add OMNIGENT_OIDC_ISSUER production          # e.g. https://github.com
npx vercel env add OMNIGENT_OIDC_CLIENT_ID production
npx vercel env add OMNIGENT_OIDC_CLIENT_SECRET production
npx vercel env add OMNIGENT_OIDC_REDIRECT_URI production    # https://<project>.vercel.app/auth/callback
openssl rand -hex 32 | npx vercel env add OMNIGENT_OIDC_COOKIE_SECRET production
```

Redeploy to apply. For Google Workspace, also set
`OMNIGENT_OIDC_ALLOWED_DOMAINS` to restrict logins to your domain.

## Constraints

- **Tunnel churn.** Every WebSocket closes at the function's max duration
  (300 s Hobby / 800 s Pro / 1800 s beta). Runners and hosts reconnect with
  ~0.5 s backoff and running turns resume; a tunnel-proxied request caught
  mid-flight at the cut fails once. Browser SSE streams and terminal tabs
  reconnect the same way.
- **Effectively single-instance.** The server keeps its runner registry and
  live-event fan-out in process memory, and Vercel pins each WebSocket to
  one instance while routing other requests freely. Under light traffic one
  warm instance serves everything and this works; under bursty load or
  mid-redeploy, requests can land on an instance that can't see your
  runner's tunnel and fail until the tunnels cycle. There is no
  single-instance pin on Vercel (unlike Modal's `max_containers=1`).
- **No persistent disk.** Postgres is required (no SQLite lite tier), the
  cookie secret must be pinned via env, and artifacts need an S3-compatible
  bucket to survive.
- **4.5 MB request-body cap** on Vercel functions — pushing an agent bundle
  larger than that fails; trim the bundle.
- **No scale-to-zero with connected runners.** A live tunnel keeps the
  instance provisioned (memory is billed for instance lifetime; CPU only
  while messages flow). With no runners or browsers connected, the instance
  scales in after ~5 minutes and the next request cold-starts in a few
  seconds.

## Cost

Fluid compute bills Active CPU (~$0.13/CPU-hr), provisioned memory
(~$0.01/GB-hr while any instance is up), and invocations. A lightly used
deploy with a runner connected during working hours lands in the low
dollars/month on Pro; Hobby's included allotment covers kicking the tires.
Neon has a free tier; marketplace billing is unified through Vercel.
