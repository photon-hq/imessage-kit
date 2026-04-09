# Penn Dining Agent — Setup Guide

## 1. Google Sheets Database

### Create the Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet named **"Penn Dining Agent"**.
2. Create three tabs (sheets) with these exact names:
   - `reviews`
   - `pending_followups`
   - `conversation_state`

### Tab Headers

**`reviews` tab — Row 1:**
```
timestamp | phone_hash | venue | date | meal_period | rating | comment | food_highlights
```

**`pending_followups` tab — Row 1:**
```
id | phone_hash | venue | meal_period | date | scheduled_for | status
```
Status values: `pending` → `sent` → `responded`

**`conversation_state` tab — Row 1:**
```
phone_hash | state | context_json | updated_at
```
State values: `idle` | `awaiting_review`

### Get the Spreadsheet ID

From the URL `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`, copy the `SPREADSHEET_ID`.

---

## 2. Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or use an existing one).
3. Enable the **Google Sheets API** for the project.
4. Go to **IAM & Admin → Service Accounts → Create Service Account**.
5. Give it any name (e.g., `penn-dining-bot`). No roles needed.
6. Click the service account → **Keys → Add Key → Create New Key → JSON**.
7. Download the JSON key file and save it as `agent/service-account.json` (never commit this).
8. **Share your spreadsheet** with the service account's email (found in the JSON as `client_email`), giving it **Editor** access.

---

## 3. Gemini API Key

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## 4. Environment Variables

Create `agent/.env` with the following values:

```env
# Google Gemini (LLM)
GEMINI_API_KEY=AIza...

# Google Sheets (database)
GOOGLE_SHEET_ID=1XBS3fi3q51nRGuuQT0ExQ2xYXK1PeHPmBAGTI7oNzyo
GOOGLE_SERVICE_ACCOUNT_PATH=./service-account.json
```

- `GEMINI_API_KEY` — your Gemini API key from Google AI Studio
- `GOOGLE_SHEET_ID` — the ID from your spreadsheet URL (the value above is the live DininGuru database)
- `GOOGLE_SERVICE_ACCOUNT_PATH` — path to the service account JSON downloaded in step 2; the service account must have **Editor** access to the sheet

---

## 5. Install & Run

```bash
cd agent
npm install
npm start
```

The bot will start watching your iMessage inbox. Make sure your terminal has **Full Disk Access** (System Settings → Privacy & Security → Full Disk Access).

---

## 6. Grant Permissions

The bot needs iMessage automation permissions. The first time it tries to send a message, macOS will prompt you to allow the terminal app to control Messages. Click **OK**.
