#!/usr/bin/env node

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Configuration
const CONFIG = {
  collectionsFile: path.join(__dirname, 'collections.json'),
  historyFile: path.join(__dirname, 'history.json'),
  webhookUrl: 'https://hook.eu2.make.com/sudwxmtwbxvegyi99iqob91k59i50ujy',
  ooxBaseUrl: 'https://api.oox.art',
  maxHistoryDays: 30, // Keep up to 1 month of data
  runSchedule: '0 13 * * *', // Daily at 13:00 UTC (1 PM UK time in winter)
  testMode: process.argv.includes('--test')
};

// Load collections
function loadCollections() {
  try {
    const data = fs.readFileSync(CONFIG.collectionsFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load collections.json:', err.message);
    process.exit(1);
  }
}

// Load history
function loadHistory() {
  try {
    if (!fs.existsSync(CONFIG.historyFile)) {
      return {};
    }
    const data = fs.readFileSync(CONFIG.historyFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.warn('Could not load history, starting fresh:', err.message);
    return {};
  }
}

// Save history
function saveHistory(history) {
  try {
    fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('Failed to save history:', err.message);
  }
}

// Clean old history entries (older than maxHistoryDays)
function cleanHistory(history) {
  const cutoff = Date.now() - (CONFIG.maxHistoryDays * 24 * 60 * 60 * 1000);
  const cleaned = {};
  
  for (const [collectionId, entries] of Object.entries(history)) {
    const recent = entries.filter(entry => entry.timestamp >= cutoff);
    if (recent.length > 0) {
      cleaned[collectionId] = recent;
    }
  }
  
  return cleaned;
}

// Fetch floor listing from OOX
// Note: OOX returns listings in mixed payment tokens (EGLD, ONX, etc). The API sorts by
// USD value (cheapest first), but listing.price is in the listing's native token.
// We normalize to EGLD using dollarValue to avoid treating e.g. 20000 ONX as 20000 EGLD.
async function fetchFloorListing(collectionId, egldPrice) {
  const url = `${CONFIG.ooxBaseUrl}/auctions-collection?collection=${collectionId}&size=1&sort=price_asc&chainId=multiversx`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OOX API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // OOX returns array of listings
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }
    
    const listing = data[0];
    
    // Normalize price to EGLD: use dollarValue when available (handles ONX, USDC, etc),
    // otherwise fall back to listing.price (assumed EGLD when buyTokenId is EGLD)
    let price_egld;
    if (listing.dollarValue != null && listing.dollarValue > 0 && egldPrice > 0) {
      price_egld = listing.dollarValue / egldPrice;
    } else {
      price_egld = parseFloat(listing.price || 0);
    }
    
    // Extract IPFS URL from media array
    let ipfsUrl = '';
    if (listing.media && listing.media.length > 0 && listing.media[0].originalUrl) {
      ipfsUrl = listing.media[0].originalUrl;
    }
    
    return {
      nft_id: listing.identifier || '',
      price_egld,
      seller: '?', // OOX doesn't expose seller in this endpoint
      market: listing.marketplace || 'unknown',
      thumb: listing.thumbnailUrl || '',
      ipfs: ipfsUrl
    };
  } catch (err) {
    console.error(`Failed to fetch floor for ${collectionId}:`, err.message);
    return null;
  }
}

// Get EGLD/USD price from MultiversX API
async function fetchEGLDPrice() {
  try {
    const response = await fetch('https://api.multiversx.com/tokens/WEGLD-bd4d79?fields=price');
    if (!response.ok) {
      throw new Error(`MVX API error: ${response.status}`);
    }
    const data = await response.json();
    return parseFloat(data.price);
  } catch (err) {
    console.error('Failed to fetch EGLD price, using fallback 4.2:', err.message);
    return 4.2; // Fallback
  }
}

// Calculate percentage changes
// Uses the OLDEST price within each window (closest to 1d/1w/1m ago) so each timeframe
// compares current vs the appropriate historical point.
function calculateChanges(collectionId, currentPrice, history) {
  const entries = history[collectionId] || [];
  if (entries.length === 0) return { change1d: null, change1w: null, change1m: null };
  
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;
  
  let price1d = null, price1w = null, price1m = null;
  let bestAge1d = 0, bestAge1w = 0, bestAge1m = 0;
  
  for (const entry of entries) {
    const age = now - entry.timestamp;
    // Use the entry with the largest age within each window (furthest back in time)
    if (age <= oneDay && age > bestAge1d) {
      bestAge1d = age;
      price1d = entry.price_egld;
    }
    if (age <= oneWeek && age > bestAge1w) {
      bestAge1w = age;
      price1w = entry.price_egld;
    }
    if (age <= oneMonth && age > bestAge1m) {
      bestAge1m = age;
      price1m = entry.price_egld;
    }
  }
  
  const calcChange = (oldPrice) => oldPrice ? ((currentPrice - oldPrice) / oldPrice) * 100 : null;
  
  return {
    change1d: calcChange(price1d),
    change1w: calcChange(price1w),
    change1m: calcChange(price1m)
  };
}

// Main tracking function
async function runTracking() {
  console.log(`[${new Date().toISOString()}] Starting floor tracking...`);
  
  const collections = loadCollections();
  const history = loadHistory();
  const egldPrice = await fetchEGLDPrice();
  
  const results = [];
  
  for (const collection of collections) {
    console.log(`  Fetching ${collection.identifier} (${collection.name})...`);
    
    const floor = await fetchFloorListing(collection.identifier, egldPrice);
    if (!floor) {
      console.log(`    No floor found for ${collection.identifier}`);
      continue;
    }
    
    // Calculate USD price
    const price_usd = floor.price_egld * egldPrice;
    
    // Calculate percentage changes
    const changes = calculateChanges(collection.identifier, floor.price_egld, history);
    
    // Prepare result
    const result = {
      collection: collection.identifier,
      name: collection.name,
      x_handle: collection.x_handle,
      floor: {
        ...floor,
        price_usd: parseFloat(price_usd.toFixed(3))
      },
      changes: {
        change1d: changes.change1d !== null ? parseFloat(changes.change1d.toFixed(2)) : null,
        change1w: changes.change1w !== null ? parseFloat(changes.change1w.toFixed(2)) : null,
        change1m: changes.change1m !== null ? parseFloat(changes.change1m.toFixed(2)) : null
      },
      timestamp: Date.now(),
      egld_usd: egldPrice
    };
    
    results.push(result);
    
    // Update history
    if (!history[collection.identifier]) {
      history[collection.identifier] = [];
    }
    history[collection.identifier].unshift({
      timestamp: Date.now(),
      price_egld: floor.price_egld,
      price_usd: price_usd
    });
    
    // Keep only latest 100 entries per collection
    if (history[collection.identifier].length > 100) {
      history[collection.identifier] = history[collection.identifier].slice(0, 100);
    }
    
    console.log(`    Floor: ${floor.price_egld} EGLD ($${price_usd.toFixed(2)})`);
  }
  
  // Clean old history
  const cleanedHistory = cleanHistory(history);
  saveHistory(cleanedHistory);
  
  // Prepare webhook payload
  const payload = {
    source: 'mvx-floor-tracker',
    type: 'daily_floor_report',
    timestamp: new Date().toISOString(),
    egld_usd: egldPrice,
    collections: results
  };
  
  // Send to webhook
  try {
    const response = await fetch(CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log(`Webhook sent successfully (${results.length} collections)`);
    } else {
      console.error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.error('Failed to send webhook:', err.message);
  }
  
  // If test mode, also log to console
  if (CONFIG.testMode) {
    console.log('\n--- TEST OUTPUT ---');
    console.log(JSON.stringify(payload, null, 2));
  }
  
  console.log(`[${new Date().toISOString()}] Tracking complete.\n`);
  return results;
}

// Main execution
if (CONFIG.testMode) {
  console.log('Running in test mode...');
  runTracking().then(() => {
    console.log('Test complete.');
    process.exit(0);
  }).catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
} else {
  // Schedule the job
  console.log(`Scheduled to run daily at ${CONFIG.runSchedule} (UTC)`);
  cron.schedule(CONFIG.runSchedule, () => {
    runTracking().catch(err => {
      console.error('Scheduled run failed:', err);
    });
  });
  
  // Keep the process alive
  console.log('Tracker is running. Press Ctrl+C to exit.');
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
  });
}
