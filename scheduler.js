const cron     = require('node-cron');
const { argv } = require('yargs').option('count', { type: 'number', default: 10 });
const { handleMode3 } = require('./newunion');  // pastikan Anda mengekspor fungsi ini

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runBatch() {
  for (let i = 0; i < argv.count; i++) {
    await handleMode3();
    console.log(`✅ Transaction ${i+1}/${argv.count} done`);
    await sleep(5000);
  }
}

// jadwal: setiap hari jam 00:00
cron.schedule('0 0 * * *', () => {
  console.log('Starting daily batch at', new Date().toISOString());
  runBatch().catch(console.error);
}, { timezone: 'Asia/Jakarta' });

console.log('Scheduler running... (daily at 00:00 Jakarta time)');
