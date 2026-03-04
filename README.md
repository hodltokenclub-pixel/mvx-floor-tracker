# MVX Floor Tracker

Daily floor price tracker for MultiversX NFT collections via OOX API.

## Features

- Fetches the cheapest (floor) listing for each configured collection
- Calculates USD values using live EGLD price from MultiversX API
- Tracks historical data with 1D, 1W, 1M percentage changes
- Auto‑cleans data older than 30 days
- Sends aggregated JSON payload to a Make.com webhook
- Runs daily at 1 PM UK time (13:00 UTC)
- Easy to add/remove collections via `collections.json`

## Setup

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd mvx-floor-tracker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure collections in `collections.json`:
   ```json
   [
     {
       "identifier": "EMP-897b49",
       "name": "Empyreans",
       "x_handle": "@HodlTokenClub"
     },
     ...
   ]
   ```

4. (Optional) Update the webhook URL in `tracker.js` if needed:
   ```javascript
   const CONFIG = {
     webhookUrl: 'https://hook.eu2.make.com/sudwxmtwbxvegyi99iqob91k59i50ujy',
     ...
   };
   ```

## Usage

### Test run
```bash
npm test
# or
node tracker.js --test
```

### Start the scheduler (for production)
```bash
npm start
```

The script will:
- Run immediately once
- Schedule daily runs at 13:00 UTC
- Keep the process alive

### Alternative: Systemd/cron
If you prefer not to keep a Node process running, you can use systemd or cron:

**Cron example** (run daily at 13:00 UTC):
```cron
0 13 * * * cd /path/to/mvx-floor-tracker && node tracker.js >> /var/log/mvx-floor-tracker.log 2>&1
```

## Output Format

The webhook receives a JSON payload like:

```json
{
  "source": "mvx-floor-tracker",
  "type": "daily_floor_report",
  "timestamp": "2026-03-04T21:38:00.000Z",
  "egld_usd": 4.208141222618095,
  "collections": [
    {
      "collection": "EMP-897b49",
      "name": "Empyreans",
      "x_handle": "@HodlTokenClub",
      "floor": {
        "nft_id": "EMP-897b49-1d97",
        "price_egld": 0.45,
        "price_usd": 1.894,
        "seller": "?",
        "market": "xoxno",
        "thumb": "https://media.oox.art/nfts/thumbnail/EMP-897b49-f9ba7f3b",
        "ipfs": "https://ipfs.io/ipfs/..."
      },
      "changes": {
        "change1d": 2.5,
        "change1w": -1.2,
        "change1m": 15.8
      },
      "timestamp": 1772650000000,
      "egld_usd": 4.208141222618095
    },
    ...
  ]
}
```

## Data Storage

Historical data is stored in `history.json` with this structure:

```json
{
  "EMP-897b49": [
    {
      "timestamp": 1772650000000,
      "price_egld": 0.45,
      "price_usd": 1.894
    },
    ...
  ]
}
```

The script automatically:
- Keeps up to 100 entries per collection
- Deletes entries older than 30 days
- Uses this data to calculate percentage changes

## Adding Collections

1. Edit `collections.json`
2. Add a new object with:
   - `identifier`: The collection ID (e.g., `EMP-897b49`)
   - `name`: Human‑readable name
   - `x_handle`: Twitter/X handle (include `@`)
3. No code changes needed

## Error Handling

- Failed API calls are logged and skipped (other collections continue)
- If EGLD price fetch fails, uses fallback value of 4.2
- Webhook failures are logged but don't stop the process
- History file corruption results in fresh start (no crash)

## Requirements

- Node.js 18+
- Internet access (OOX API, MultiversX API, your webhook)

## License

MIT
