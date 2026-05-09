# Swing Copilot

AI-powered swing trading signal tool. Upload 4 chart screenshots, get an instant analysis.

---

## Deploy to Netlify in 5 minutes

### Step 1 — Get your Anthropic API key
1. Go to https://console.anthropic.com
2. Click **API Keys** → **Create Key**
3. Copy the key (starts with `sk-ant-...`)

### Step 2 — Put the files on GitHub
1. Go to https://github.com and create a free account if you don't have one
2. Click **New repository** → name it `swing-copilot` → click **Create**
3. Upload all 3 files into the repo:
   - `index.html`
   - `netlify.toml`
   - `netlify/functions/analyze.js`

### Step 3 — Connect to Netlify
1. Go to https://netlify.com and sign up (free)
2. Click **Add new site** → **Import an existing project**
3. Connect your GitHub account and select the `swing-copilot` repo
4. Leave all build settings as default → click **Deploy site**

### Step 4 — Add your API key
1. In Netlify, go to **Site settings** → **Environment variables**
2. Click **Add a variable**
3. Key: `ANTHROPIC_API_KEY`
4. Value: paste your key from Step 1
5. Click **Save**
6. Go to **Deploys** → **Trigger deploy** → **Deploy site**

### Done
Your app is live at a Netlify URL like `https://your-site-name.netlify.app`

---

## How it works

- User fills in instrument, RR, context
- Uploads 4 screenshots (Weekly, Daily, 4H, 1H)
- Clicks Analyze
- Frontend sends images + settings to the Netlify Function
- Netlify Function calls Anthropic API with your key (never exposed to the user)
- Result appears on screen instantly

## File structure

```
swing-copilot/
├── index.html                    # The entire frontend
├── netlify.toml                  # Netlify config
└── netlify/
    └── functions/
        └── analyze.js            # Secure API proxy
```
