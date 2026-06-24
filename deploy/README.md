# MegIA — Uptime Kuma Deployment

Custom build for MegIA infrastructure. Runs on server .19 (76.13.24.19) monitoring .100 apps.

## Branch strategy

| Branch | Purpose |
|--------|---------|
| `master` | Tracks upstream `louislam/uptime-kuma` — merge updates here |
| `megia-custom` | MegIA production branch — custom features on top of master |

### Pulling upstream updates

```bash
git fetch upstream
git checkout master
git merge upstream/master
git push origin master

git checkout megia-custom
git merge master
# Resolve conflicts if any, then push
git push origin megia-custom
```

## Deploy on .19

```bash
# First time
git clone -b megia-custom https://github.com/MegIA-Devs/uptime-kuma.git
cd uptime-kuma/deploy
docker compose build
docker compose up -d

# Update (after pushing changes to megia-custom)
git pull origin megia-custom
docker compose build --no-cache
docker compose up -d
```

Access: `http://76.13.24.19:3001`

## Notifications — Microsoft Teams

1. In Teams: channel settings → Connectors → Incoming Webhook → copy URL
2. In Uptime Kuma: Settings → Notifications → Add → Microsoft Teams → paste URL
3. Assign the notification to monitors
