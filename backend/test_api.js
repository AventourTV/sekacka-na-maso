'use strict';
require('dotenv').config();
const axios = require('axios');

async function testConnection() {
  const apiKey = process.env.OF_API_KEY;
  const accountId = 'acct_efef858fa72b4de4955666f8ccc2b770'; // Your provided ID
  const baseUrl = 'https://app.onlyfansapi.com/api';

  console.log('--- OnlyFansAPI.com Connection Test ---');
  console.log(`Target URL: ${baseUrl}`);
  console.log(`API Key:    ${apiKey ? apiKey.slice(0, 10) + '...' : 'MISSING'}`);
  console.log(`Account ID: ${accountId}`);
  console.log('---------------------------------------\n');

  if (!apiKey) {
    console.error('❌ ERROR: OF_API_KEY is missing from your .env file!');
    return;
  }

  const client = axios.create({
    baseURL: baseUrl,
    timeout: 15000, // 15s timeout for this test
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    }
  });

  // Step 1: Test general API Key validity
  console.log('Step 1: Testing API Key validity (/api/me)...');
  try {
    const resMe = await client.get('/me');
    console.log('✅ PASS: API Key is valid.');
    console.log(`   User Info: ${JSON.stringify(resMe.data)}\n`);
  } catch (err) {
    console.error(`❌ FAIL: API Key test failed.`);
    console.error(`   Error: ${err.response?.status} ${err.response?.statusText || ''}`);
    console.error(`   Message: ${err.response?.data?.message || err.message}\n`);
    if (err.code === 'ECONNABORTED') console.log('   (Request timed out - server might be down or blocked)\n');
  }

  // Step 2: Test Account access
  console.log(`Step 2: Testing Account access (/api/${accountId}/chats)...`);
  try {
    const resChats = await client.get(`/${accountId}/chats`);
    console.log('✅ PASS: Account is reachable and online.');
    console.log(`   Found ${resChats.data?.data?.length || 0} chats.\n`);
  } catch (err) {
    console.error(`❌ FAIL: Could not reach account.`);
    console.error(`   Error: ${err.response?.status} ${err.response?.statusText || ''}`);
    console.error(`   Message: ${err.response?.data?.message || err.message}\n`);
    
    if (err.code === 'ECONNABORTED') {
      console.log('   ⚠️ CRITICAL: The request timed out.');
      console.log('   This usually means the account is "OFFLINE" in your OnlyFansAPI dashboard.');
      console.log('   Please check https://onlyfansapi.com/ and make sure the account is "Online".\n');
    }
  }

  console.log('--- Test Complete ---');
}

testConnection();
