# Deployment Guide for Bargaining App

This guide covers how to deploy the bargaining game to a public website.

## Option 1: Railway (Recommended - Easiest)

Railway offers free tier and automatic deployments.

### Steps:

1. **Create a Railway account**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Install Railway CLI** (optional, can also use web UI)
   ```bash
   npm install -g @railway/cli
   railway login
   ```

3. **Deploy from GitHub (Web UI method)**
   - Click "New Project" in Railway dashboard
   - Select "Deploy from GitHub repo"
   - Choose `dipplestix/bargaining-app`
   - Railway auto-detects Node.js and runs `npm start`

4. **Or deploy via CLI**
   ```bash
   cd /home/dipplestix/Projects/bargaining-app
   railway init
   railway up
   ```

5. **Get your public URL**
   - Railway provides a URL like `bargaining-app-production.up.railway.app`
   - Go to Settings → Generate Domain (if not auto-generated)

6. **Done!** Share the URL with players.

---

## Option 2: Render

Render has a generous free tier.

### Steps:

1. **Create account**
   - Go to https://render.com
   - Sign up with GitHub

2. **Create new Web Service**
   - Click "New" → "Web Service"
   - Connect your GitHub repo: `dipplestix/bargaining-app`

3. **Configure settings**
   - Name: `bargaining-game`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free

4. **Deploy**
   - Click "Create Web Service"
   - Wait for build to complete (~2-3 minutes)

5. **Access your app**
   - URL will be like `bargaining-game.onrender.com`

### Note on Render Free Tier:
- Free instances spin down after 15 min of inactivity
- First request after sleep takes ~30 seconds
- Upgrade to paid ($7/mo) for always-on

---

## Option 3: Fly.io

Good performance, generous free tier.

### Steps:

1. **Install Fly CLI**
   ```bash
   # Linux
   curl -L https://fly.io/install.sh | sh

   # Or with npm
   npm install -g flyctl
   ```

2. **Sign up and login**
   ```bash
   flyctl auth signup
   # or if you have an account:
   flyctl auth login
   ```

3. **Launch the app**
   ```bash
   cd /home/dipplestix/Projects/bargaining-app
   flyctl launch
   ```
   - Say yes to copy config to new app
   - Choose a region close to your players
   - Say no to PostgreSQL (we use SQLite)
   - Say yes to deploy now

4. **Your app is live!**
   - URL: `bargaining-app.fly.dev` (or similar)

---

## Option 4: DigitalOcean App Platform

Simple PaaS with predictable pricing.

### Steps:

1. Go to https://cloud.digitalocean.com/apps
2. Click "Create App"
3. Connect GitHub → select `bargaining-app` repo
4. Configure:
   - Type: Web Service
   - Run Command: `npm start`
   - HTTP Port: 8888
5. Choose plan (Basic $5/mo or free tier if available)
6. Deploy

---

## Important Notes for All Platforms

### Environment Variables
If needed, set these in your platform's dashboard:
```
PORT=8888        # Usually auto-detected
NODE_ENV=production
```

### Database Persistence
The SQLite database (`bargaining.db`) stores game data. On most platforms:
- **Railway**: Persists between deploys with volumes
- **Render**: Lost on redeploy (free tier) - add a disk for persistence
- **Fly.io**: Add a volume for persistence:
  ```bash
  flyctl volumes create bargaining_data --size 1
  ```

For production with important data, consider switching to PostgreSQL (all platforms offer managed Postgres).

### WebSocket Support
All recommended platforms support WebSockets out of the box. No special configuration needed.

### Custom Domain (Optional)
All platforms let you add a custom domain:
1. Add domain in platform dashboard
2. Update DNS records (CNAME to platform URL)
3. SSL certificate is automatic

---

## Quick Comparison

| Platform | Free Tier | Always On | Setup Time |
|----------|-----------|-----------|------------|
| Railway  | $5 credit/mo | Yes | 5 min |
| Render   | Yes (sleeps) | Paid only | 5 min |
| Fly.io   | Yes | Yes | 10 min |
| DigitalOcean | No | Yes | 10 min |

---

## Testing Your Deployment

Once deployed:

1. Open the URL in your browser
2. Enter a name and create a game
3. Open the URL in another browser/incognito window
4. Join the game with the code
5. Play!

If something doesn't work:
- Check platform logs for errors
- Ensure WebSocket connections work (most platforms handle this automatically)
- Verify the PORT environment variable if manually configured

---

## Updating Your Deployment

After making changes locally:

```bash
git add -A
git commit -m "Your changes"
git push
```

Most platforms auto-deploy on push to main/master branch.
