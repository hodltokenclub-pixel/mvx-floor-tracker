const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function test() {
  const url = 'https://api.oox.art/auctions-collection?collection=EMP-897b49&size=1&sort=price_asc&chainId=multiversx';
  console.log('Testing URL:', url);
  
  try {
    const response = await fetch(url);
    console.log('Status:', response.status, response.statusText);
    const data = await response.json();
    console.log('Data length:', Array.isArray(data) ? data.length : 'not array');
    console.log('First item:', JSON.stringify(data[0], null, 2).substring(0, 500));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();