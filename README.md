# Ledger

A deadline planner that shows your own tasks and deadlines *alongside* real
public holidays (and optionally, nearby events) — so you can actually see
whether a deadline lands on a holiday, plan around a long weekend, or notice
a scheduling conflict before it's too late. Plain to-do lists don't give you
that context; Ledger does.

# Ledger video:  [ledger video link](https://youtu.be/qhoZiNwIHpY)
# Leger app link: http://34.205.129.125/

## APIs used

- **[Nager.Date](https://date.nager.at/)** — free public holiday API, no key
  required. Used to overlay public holidays for a selected country onto the
  calendar view.
  Endpoint used: `GET https://date.nager.at/api/v3/PublicHolidays/{year}/{countryCode}`
- **[Ticketmaster Discovery API](https://developer.ticketmaster.com/)**
  (optional) — used to overlay nearby real-world events on the calendar.
  Requires a free API key from Ticketmaster's developer portal.

Full credit to both API providers — see the in-app footer for links.

## Running locally

The app now has two parts: a static frontend and a small backend API
with a SQLite database.

**1. Start the backend:**
```bash
cd backend
npm install
npm start
# API listening on http://localhost:3000
```

**2. Serve the frontend** (from a separate terminal):
```bash
cd web
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

The frontend calls relative `/api/...` paths, so for local development
you'll want a way to route those to `localhost:3000` — the simplest option
is a one-line proxy in front of both, e.g. via `nginx` locally, or by
temporarily changing `API_BASE` in `web/app.js` to
`http://localhost:3000/api` while developing. In the deployed setup below,
nginx handles this proxying for you automatically.

1. On load, the app defaults to holidays for `US`. Change the **country
   code** field (top of the calendar panel) to any ISO 3166 2-letter code
   (e.g. `RW`, `KE`, `GB`) to see that country's holidays instead.
2. Click **+ New entry** to add a deadline: title, due date, category,
   priority, optional notes, and an optional link.
3. Use the search box, category filter, and sort dropdown above the entry
   list to find and organize deadlines.
4. Optionally expand **"Nearby events (Ticketmaster)"**, paste in your own
   Ticketmaster API key and a city, and click **Fetch events** to overlay
   local events on the calendar too.

### About the API key

Ticketmaster's key is entered by *you*, in the browser, and stored only in
that browser's `localStorage` — it is never written to any file in this
repository and never committed to source control (see `.gitignore`). This
keeps the assignment's "no exposed API keys" requirement even though this
call happens client-side. For a production deployment, the recommended next
step would be routing that call through the backend so the key never
reaches the client at all — noted here as a known limitation.

## Data storage

Deadlines are stored in a real SQLite database (`backend/data.sqlite`,
excluded from git via `.gitignore`) via a small Express REST API
(`backend/server.js`). The API exposes:

| Method | Path              | Purpose            |
|--------|-------------------|---------------------|
| GET    | `/api/entries`    | list all entries    |
| POST   | `/api/entries`    | create an entry     |
| PUT    | `/api/entries/:id`| update an entry     |
| DELETE | `/api/entries/:id`| delete an entry     |
| GET    | `/api/health`     | health check        |

**Why one database host, not one per web server:** SQLite is a file, not a
network service. If Web01 and Web02 each ran their own separate database
file, a deadline added while the load balancer happened to route you to
Web01 wouldn't exist on Web02, and vice versa — the two servers would
silently drift out of sync. To avoid that, this project runs the API +
SQLite database on a single host (Web01, in the deployment steps below),
and both web servers proxy `/api/*` requests to that one host through
nginx. The frontend's static assets (HTML/CSS/JS) are still fully
replicated across both web servers, so only the actual API/database layer
is centralized — which is the same "stateless web tier, single data tier"
pattern used in most real deployments, just without database replication
since that's out of scope for this project's size.

## Deployment (Web01, Web02, Lb01)

### 1. Deploy the API + database (once, on a single host — Web01 here)

```bash
chmod +x deploy/deploy_api.sh
sudo ./deploy/deploy_api.sh
```

This installs Node.js and `pm2` (a lightweight process manager that keeps
the API running across reboots/logouts without needing `systemctl`), copies
`backend/` to `/opt/ledger-api`, installs dependencies, and starts the API
on port 3000.

### 2. Deploy the frontend to each web server

On **both** Web01 and Web02, run:

```bash
chmod +x deploy/deploy_web.sh
sudo ./deploy/deploy_web.sh web01 <WEB01_IP>   # on Web01
sudo ./deploy/deploy_web.sh web02 <WEB01_IP>   # on Web02
```

Note both commands point at `<WEB01_IP>` (or wherever you ran
`deploy_api.sh`) — that's the single host running the database, so both web
servers proxy API traffic there regardless of which one is serving the
static page. This script:
- Installs `nginx` if it isn't already present.
- Copies the app into `/var/www/ledger`.
- Adds an `X-Served-By` response header carrying the server's label, so you
  can verify which server answered a given request once traffic is going
  through the load balancer.
- Configures nginx to proxy any `/api/...` request to the API host on port
  3000, and serve everything else as static files.
- Restarts nginx with `service nginx restart` (not `systemctl`, consistent
  with earlier constraints in this course).

### 3. Configure the load balancer

On Lb01, install HAProxy and use the provided config:

```bash
sudo apt-get update -y
sudo apt-get install -y haproxy
sudo cp deploy/haproxy.cfg /etc/haproxy/haproxy.cfg
```

Before restarting, edit `/etc/haproxy/haproxy.cfg` and replace
`<WEB01_IP>` and `<WEB02_IP>` with the actual private IPs of Web01 and
Web02:

```
server web01 10.0.0.11:80 check
server web02 10.0.0.12:80 check
```

Then restart HAProxy:

```bash
sudo service haproxy restart
```

The config uses `balance roundrobin`, so requests alternate between Web01
and Web02, and `option httpchk GET /` so HAProxy stops routing to a server
that stops responding.

### 4. Verify load balancing and shared data

From your local machine, repeatedly curl the load balancer's IP and check
the `X-Served-By` header:

```bash
curl -sI http://<LB01_IP>/ | grep X-Served-By
curl -sI http://<LB01_IP>/ | grep X-Served-By
curl -sI http://<LB01_IP>/ | grep X-Served-By
```

You should see the value alternate between `web01` and `web02` across
requests. Then, add a deadline through the load balancer's address, refresh
a few times, and confirm the same entry appears every time regardless of
which server answered — that confirms both web servers are correctly
sharing the one backend database rather than each keeping separate,
inconsistent state.

## Error handling

- If the backend API is unreachable, the frontend shows an alert and falls
  back to an empty entry list rather than crashing.
- Field validation happens both client-side (HTML5 required/date/url
  input types) and server-side (`validateEntry` in `server.js`), so bad
  data can't reach the database even if a request bypasses the UI.
- If the Nager.Date request fails (network issue, unsupported country code,
  API downtime), the app logs the error to the console and simply shows the
  calendar without holiday badges for that month, rather than breaking the
  page.
- If the Ticketmaster request fails (bad key, bad city, rate limit), the
  user gets a clear on-screen alert rather than a silent failure.

## Challenges

- **Static-only frontend vs. API key secrecy:** the frontend itself has no
  backend of its own to hide the optional Ticketmaster key behind, so that
  integration is explicitly opt-in and user-supplied, with the tradeoff
  documented above.
- **Keeping data consistent behind a load balancer:** the biggest design
  decision in adding a database was recognizing that SQLite is a local
  file, not something two independent servers can share without extra
  infrastructure — solved by centralizing the API + database on a single
  host and having both web servers proxy to it, rather than running two
  disconnected copies of the data.
- **Calendar edge cases:** rendering a 6-row month grid that correctly
  shows the tail end of the previous month and the start of the next
  required careful date-math (`daysInPrevMonth`, cell offset by
  `firstOfMonth.getDay()`), rather than assuming every month starts on a
  grid boundary.

## Credits

- Holiday data: [Nager.Date](https://date.nager.at/)
- Event data: [Ticketmaster Discovery API](https://developer.ticketmaster.com/)
- Fonts: [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) and
  [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) via
  Google Fonts
