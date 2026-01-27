<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1uS8CjaenExoPw_QphDr2Dq2oMhmxcneO

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Configure Supabase via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in [.env.local](.env.local)
3. Run the app:
   `npm run dev`

## Run main + POS locally

- Main ERP (port 3000):
  - Create `.env.local` from `.env.example`
  - Run: `npm run dev:main`

- POS app (port 3001):
  - Create `.env.pos.local` from `.env.pos.local.example`
  - Run: `npm run dev:pos`
