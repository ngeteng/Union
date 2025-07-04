const fs = require('fs');
const path = require('path');
const { sendReport } = require('./telegramReporter');
const { ethers } = require('ethers');
const axios = require('axios');
const moment = require('moment-timezone');
const readline = require('readline');
const { DirectSecp256k1HdWallet } = require('@cosmjs/proto-signing');
require('dotenv').config();

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m"
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`  Union Testnet Auto Bot - Airdrop Insiders  `);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

let reportBuffer = [];
function bufferReport(text) {
  reportBuffer.push(text);
}

async function flushReport() {
  if (!reportBuffer.length) return;
  try {
    await sendReport(reportBuffer.join("\n"));
  } catch (err) {
    logger.error(`Telegram report failed: ${err.message}`);
  }
  reportBuffer = [];
}

const UCS03_ABI = [ { inputs: [ { internalType: 'uint32', name: 'channelId', type: 'uint32' }, { internalType: 'uint64', name: 'timeoutHeight', type: 'uint64' }, { internalType: 'uint64', name: 'timeoutTimestamp', type: 'uint64' }, { internalType: 'bytes32', name: 'salt', type: 'bytes32' }, { components: [ { internalType: 'uint8', name: 'version', type: 'uint8' }, { internalType: 'uint8', name: 'opcode', type: 'uint8' }, { internalType: 'bytes', name: 'operand', type: 'bytes' }, ], internalType: 'struct Instruction', name: 'instruction', type: 'tuple', }, ], name: 'send', outputs: [], stateMutability: 'nonpayable', type: 'function', }, ];
const USDC_ABI = [ { constant: true, inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], type: 'function', stateMutability: 'view', }, { constant: true, inputs: [ { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, ], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], type: 'function', stateMutability: 'view', }, { constant: false, inputs: [ { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, ], name: 'approve', outputs: [{ name: '', type: 'bool' }], type: 'function', stateMutability: 'nonpayable', }, ];

const contractAddress = '0x5FbE74A283f7954f10AA04C2eDf55578811aeb03';
const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const graphqlEndpoint = 'https://graphql.union.build/v1/graphql';
const baseExplorerUrl = 'https://sepolia.etherscan.io';
const unionUrl = 'https://app.union.build/explorer';

const rpcProviders = [
  new ethers.providers.JsonRpcProvider(process.env.RPC_URL_PRIV)
];
let currentRpcProviderIndex = 0;

function provider() {
  return rpcProviders[currentRpcProviderIndex];
}

function rotateRpcProvider() {
  currentRpcProviderIndex = (currentRpcProviderIndex + 1) % rpcProviders.length;
  return provider();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function askQuestion(query) { return new Promise(resolve => rl.question(query, resolve)); }
const explorer = { tx: (txHash) => `${baseExplorerUrl}/tx/${txHash}`, address: (address) => `${baseExplorerUrl}/address/${address}`, };
const union = { tx: (txHash) => `${unionUrl}/transfers/${txHash}`, };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function timelog() { return moment().tz('Asia/Jakarta').format('HH:mm:ss | DD-MM-YYYY'); }
function header() { process.stdout.write('\x1Bc'); logger.banner(); }

async function pollPacketHash(txHash, retries = 50, intervalMs = 5000) {
  const headers = { 'accept': 'application/graphql-response+json, application/json', 'content-type': 'application/json', 'origin': 'https://app-union.build', 'referer': 'https://app.union.build/', 'user-agent': 'Mozilla/5.0', };
  const data = { query: `query ($submission_tx_hash: String!) { v2_transfers(args: {p_transaction_hash: $submission_tx_hash}) { packet_hash } }`, variables: { submission_tx_hash: txHash.startsWith('0x') ? txHash : `0x${txHash}`, }, };
  for (let i = 0; i < retries; i++) { try { const res = await axios.post(graphqlEndpoint, data, { headers }); const result = res.data?.data?.v2_transfers; if (result && result.length > 0 && result[0].packet_hash) { return result[0].packet_hash; } } catch (e) { logger.error(`Packet error: ${e.message}`); } await delay(intervalMs); }
  logger.warn(`No packet hash found after ${retries} retries.`);
  return null;
}

async function checkBalanceAndApprove(wallet, usdcAddress, spenderAddress) {
  const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
  const balance = await usdcContract.balanceOf(wallet.address);
  if (balance === 0n) { logger.error(`${wallet.address} not have enough USDC. Fund your wallet first!`); return false; }
  const allowance = await usdcContract.allowance(wallet.address, spenderAddress);
  if (allowance === 0n) { logger.loading(`USDC is not allowance. Sending approve transaction....`); const approveAmount = ethers.MaxUint256; try { const tx = await usdcContract.approve(spenderAddress, approveAmount); const receipt = await tx.wait(); logger.success(`Approve confirmed: ${explorer.tx(receipt.hash)}`); await delay(3000); } catch (err) { logger.error(`Approve failed: ${err.message}`); return false; } }
  return true;
}

async function sendFromWallet(walletInfo, maxTransaction, destination) {
  const wallet = new ethers.Wallet(walletInfo.privatekey, provider());
  let recipientAddress, destinationName, channelId, operand;

  if (destination === 'babylon') {
    recipientAddress = walletInfo.babylonAddress;
    destinationName = 'Babylon';
    channelId = 7;
    if (!recipientAddress) { logger.warn(`Skipping wallet '${walletInfo.name || 'Unnamed'}': Missing babylonAddress.`); return; }
    operand = `0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000002710000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000014${wallet.address.slice(2).toLowerCase()}000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a${Buffer.from(recipientAddress, "utf8").toString("hex")}0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000141c7d4b196cb0c7b01d743fbc6116a902379c72380000000000000000000000000000000000000000000000000000000000000000000000000000000000000004555344430000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045553444300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003e62626e317a7372763233616b6b6778646e77756c3732736674677632786a74356b68736e743377776a687030666668363833687a7035617135613068366e0000`;
  } else if (destination === 'holesky') {
    recipientAddress = wallet.address;
    destinationName = 'Holesky';
    channelId = 8;
    operand = `0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000002c00000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000000000014${wallet.address.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000000000000000000000000000000000014${wallet.address.slice(2).toLowerCase()}00000000000000000000000000000000000000000000000000000000000000000000000000000000000000141c7d4b196cb0c7b01d743fbc6116a902379c72380000000000000000000000000000000000000000000000000000000000000000000000000000000000000004555344430000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045553444300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001457978bfe465ad9b1c0bf80f6c1539d300705ea50000000000000000000000000`;
  } else {
    logger.error(`Invalid destination: ${destination}`);
    return;
  }

  logger.loading(`Sending ${maxTransaction} Transaction Sepolia to ${destinationName} from ${wallet.address} (${walletInfo.name || 'Unnamed'})`);

  const shouldProceed = await checkBalanceAndApprove(wallet, USDC_ADDRESS, contractAddress);
  if (!shouldProceed) {
      logger.error(`Wallet *${walletInfo.name || 'Unnamed'}*: Failed pre-check (Balance/Approve).`);
      return;
  }

  const contract = new ethers.Contract(contractAddress, UCS03_ABI, wallet);
  const timeoutHeight = 0;

  // Inisialisasi Counter & Detail untuk Laporan Baru
  let successCount = 0;
  let failCount = 0;
  let totalAmountSent = 0n; // Gunakan BigInt
  const packetHashes = [];
  const errorMessages = [];

  for (let i = 1; i <= maxTransaction; i++) {
    logger.step(`${walletInfo.name || 'Unnamed'} | Transaction ${i}/${maxTransaction}`);
    const now = BigInt(Date.now()) * 1_000_000n;
    const oneDayNs = 86_400_000_000_000n;
    const timeoutTimestamp = (now + oneDayNs).toString();
    const timestampNow = Math.floor(Date.now() / 1000);
    const packed = ethers.utils.solidityPack(['address', 'uint256'], [wallet.address, timestampNow]);
    const salt = ethers.utils.keccak256(packed);
    const instruction = { version: 0, opcode: 2, operand };

    try {
      const tx = await contract.send(channelId, timeoutHeight, timeoutTimestamp, salt, instruction);
      const receipt = await tx.wait(1);

      const usdcIface = new ethers.utils.Interface(USDC_ABI);
      const transferEvt = receipt.logs.map(l => { try { return usdcIface.parseLog(l); } catch { return null; } }).find(evt => evt && evt.name === 'Transfer');

      let amount = 'N/A';
      let amountBigInt = 0n;
      if (transferEvt) {
        amount = ethers.utils.formatUnits(transferEvt.args.value, 6);
        amountBigInt = transferEvt.args.value;
      }

      logger.success(`${timelog()} | Sent ${amount} USDC to ${destinationName}`);
      logger.info(`  ⮡ Sepolia Tx: ${explorer.tx(receipt.transactionHash || receipt.hash)}`);
      logger.loading(`  ⮡ Polling for Union packet hash...`);
      const packetHash = await pollPacketHash(receipt.transactionHash || receipt.hash);

      successCount++;
      totalAmountSent += amountBigInt;

      if (packetHash) {
        logger.success(`  ⮡ Union Packet Hash found: ${packetHash}`);
        logger.info(`  ⮡ Track on Union: ${union.tx(packetHash)}`);
        packetHashes.push(`\`${packetHash.substring(0, 12)}...\``);
      } else {
        logger.warn(`  ⮡ Could not retrieve Union packet hash.`);
        packetHashes.push(`✅ (No Packet Hash)`);
      }

    } catch (err) {
      logger.error(`Failed for ${wallet.address}: ${err.message}`);
      failCount++;
      errorMessages.push(`Tx ${i}: ${err.message.substring(0, 60)}...`);
      console.log('');
    }

    if (i < maxTransaction) {
      logger.info(`Waiting for next transaction...`);
      await delay(10000);
    }
  }

  // BUAT DAN KIRIM LAPORAN RANGKUMAN
  logger.loading(`Building and sending summary report...`);
  let summary = [];
  summary.push(`*📊 Union Bot Report - ${walletInfo.name || 'Unnamed'}*`);
  summary.push(`---------------------------------`);
  summary.push(`Destination: *${destinationName}*`);
  summary.push(`Attempted: *${maxTransaction}* | ✅ Success: *${successCount}* | ❌ Fails: *${failCount}*`);
  summary.push(`💰 Total Sent: *${ethers.utils.formatUnits(totalAmountSent, 6)} USDC*`);

  if (packetHashes.length > 0) {
    summary.push(`\n*Successful Packets (${packetHashes.length}):*`);
    packetHashes.forEach((hash, index) => summary.push(`  ${index + 1}. ${hash}`));
  }

  if (errorMessages.length > 0) {
    summary.push(`\n*Errors Encountered (${errorMessages.length}):*`);
    errorMessages.forEach(err => summary.push(`  - ${err}`));
  }
  summary.push(`---------------------------------`);
  summary.push(`_${timelog()}_`);

  bufferReport(summary.join('\n'));

  logger.loading(`Sending summary report to Telegram...`);
  await flushReport();
}

async function main() {
  header();
  const wallets = [];
  const pk = process.env.PRIVATE_KEY_1;
  if (!pk) { logger.error('No PRIVATE_KEY_1 in .env'); process.exit(1); }
  wallets.push({ name: 'Wallet1', privatekey: pk, babylonAddress: process.env.BABYLON_ADDRESS_1 || '' });
  const destinations = ['babylon', 'holesky'];
  const randomDest = destinations[Math.floor(Math.random() * destinations.length)];
  await sendFromWallet(wallets[0], 5, randomDest);
  process.exit(0);
}

main().catch(err => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
