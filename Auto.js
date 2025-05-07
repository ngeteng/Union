const fs = require('fs');
const { sendReport } = require('./telegramReporter');
const { ethers } = require('ethers');
const axios = require('axios');
const moment = require('moment-timezone');
require('dotenv').config();

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m"
};

// Simple logger
const logger = {
  info: (msg)    => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg)    => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg)   => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg)    => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`  Union Testnet Auto Bot - Airdrop Insiders  `);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

// Load ABIs, addresses, endpoints (sesuaikan dengan .env)
const UCS03_ABI = [ /* ... sama seperti sebelumnya ... */ ];
const USDC_ABI = [ /* ... sama seperti sebelumnya ... */ ];
const contractAddress   = process.env.CONTRACT_ADDRESS;
const USDC_ADDRESS      = process.env.USDC_ADDRESS;
const graphqlEndpoint   = process.env.GRAPHQL_ENDPOINT;
const baseExplorerUrl   = process.env.EXPLORER_URL;
const unionUrl          = process.env.UNION_URL;

// RPC providers rotation
const rpcProviders = process.env.RPC_URLS.split(',').map(url => new ethers.providers.JsonRpcProvider(url));
let currentRpcProviderIndex = 0;
function provider() {
  return rpcProviders[currentRpcProviderIndex];
}
function rotateRpcProvider() {
  currentRpcProviderIndex = (currentRpcProviderIndex + 1) % rpcProviders.length;
  return provider();
}

// Helpers
define function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}
function timelog() {
  return moment().tz('Asia/Jakarta').format('HH:mm:ss | DD-MM-YYYY');
}

// Poll packet hash (sama seperti sebelumya)
async function pollPacketHash(txHash, retries = 50, intervalMs = 5000) { /* ... */ }

// Approve USDC jika dibutuhkan
async function checkBalanceAndApprove(wallet, usdcAddress, spenderAddress) { /* ... */ }

// Core sending logic
async function sendFromWallet(walletInfo, maxTx, destination) { /* ... */ }

// Main entry: auto choice3
async function main() {
  logger.banner();

  // Load wallets from .env
  const wallets = [];
  for (let i = 1; ; i++) {
    const pk = process.env[`PRIVATE_KEY_${i}`];
    const babylon = process.env[`BABYLON_ADDRESS_${i}`] || '';
    if (!pk) break;
    wallets.push({
      name: `Wallet${i}`,
      privatekey: pk,
      babylonAddress: babylon
    });
  }
  if (wallets.length === 0) {
    logger.error(`No wallets found in .env. Please set PRIVATE_KEY_1...`);
    process.exit(1);
  }

  // Read max transactions per wallet
  const maxTransaction = parseInt(process.env.MAX_TRANSACTION, 10) || 1;
  logger.info(`Running in automatic random mode (choice 3) with ${maxTransaction} tx per wallet.`);

  // Process each wallet: always random between holesky & babylon
  for (const walletInfo of wallets) {
    if (!walletInfo.privatekey.startsWith('0x')) {
      logger.warn(`Skipping ${walletInfo.name}: invalid private key format.`);
      continue;
    }
    const availableDests = ['holesky', 'babylon'].filter(d => d !== 'babylon' || walletInfo.babylonAddress);
    if (availableDests.length === 0) {
      logger.warn(`Skipping ${walletInfo.name}: missing babylonAddress.`);
      continue;
    }
    for (let i = 0; i < maxTransaction; i++) {
      const dest = availableDests[Math.floor(Math.random() * availableDests.length)];
      await sendFromWallet(walletInfo, 1, dest);
      if (i < maxTransaction - 1) await delay(1000);
    }
  }
}

main().catch(err => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
