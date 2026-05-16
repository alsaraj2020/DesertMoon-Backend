import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
    const index = clean.indexOf('=');
    const key = clean.slice(0, index).trim();
    const value = clean.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);

const CFG = {
  rpcUrl: process.env.RPC_URL || 'https://solana-mainnet.core.chainstack.com/3dca3b93382ef27f6078c2e0ce27a076',
  treasuryWallet: process.env.TREASURY_WALLET || 'DgsK21QaQVcRLhJyvAHDXqVyf3ZsJ9Cgkg1cPJKYmHx9',
  tokenSymbol: process.env.TOKEN_SYMBOL || 'DMOON',
  totalSupply: Number(process.env.TOTAL_SUPPLY || 1000000000),
  presaleAllocationPercent: Number(process.env.PRESALE_ALLOCATION_PERCENT || 30),
  teamPercent: Number(process.env.TEAM_PERCENT || 10),
  presalePriceUsd: Number(process.env.PRESALE_PRICE_USD || 0.005),
  listingPriceUsd: Number(process.env.LISTING_PRICE_USD || 0.05),
  fallbackSolPriceUsd: Number(process.env.SOL_PRICE_USD || 96),
  maxWalletCapSol: Number(process.env.MAX_WALLET_CAP_SOL || 50),
  softCapSol: Number(process.env.SOFT_CAP_SOL || 15000),
  hardCapSol: Number(process.env.HARD_CAP_SOL || 75000),
  teamCliffMonths: Number(process.env.TEAM_CLIFF_MONTHS || 11),
  teamVestingMonths: Number(process.env.TEAM_VESTING_MONTHS || 18),
};

const connection = new Connection(CFG.rpcUrl, 'confirmed');
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ purchases: [] }, null, 2));
}
function loadDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let liveSolPriceUsd = CFG.fallbackSolPriceUsd;
let lastSolPriceFetch = 0;

async function getLiveSolPriceUsd() {
  const now = Date.now();
  if (now - lastSolPriceFetch < 60000 && liveSolPriceUsd > 0) return liveSolPriceUsd;

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    const price = Number(data?.solana?.usd);
    if (price > 0) {
      liveSolPriceUsd = price;
      lastSolPriceFetch = now;
    }
  } catch {
    // fallback silently
  }

  return liveSolPriceUsd || CFG.fallbackSolPriceUsd;
}

function getPriceTier(totalRaisedSol) {
  const tiers = [
    { name: 'Tier 1', minRaisedSol: 0, maxRaisedSol: 10000, priceUsd: 0.005, allocation: '15%' },
    { name: 'Tier 2', minRaisedSol: 10000, maxRaisedSol: 30000, priceUsd: 0.010, allocation: '20%' },
    { name: 'Tier 3', minRaisedSol: 30000, maxRaisedSol: 60000, priceUsd: 0.020, allocation: '25%' },
    { name: 'Tier 4', minRaisedSol: 60000, maxRaisedSol: 75000, priceUsd: 0.035, allocation: '40%' },
  ];
  const current = tiers.find((t) => totalRaisedSol >= t.minRaisedSol && totalRaisedSol < t.maxRaisedSol) || tiers[tiers.length - 1];
  const next = tiers.find((t) => t.minRaisedSol > totalRaisedSol) || null;
  return { tiers, current, next };
}

function totals(db) {
  const totalRaisedSol = db.purchases.reduce((sum, p) => sum + Number(p.solAmount || 0), 0);
  return {
    totalRaisedSol,
    hardCapSol: CFG.hardCapSol,
    percentFunded: CFG.hardCapSol > 0 ? (totalRaisedSol / CFG.hardCapSol) * 100 : 0,
  };
}

function walletTotals(db, wallet) {
  const list = db.purchases.filter((p) => String(p.wallet).toLowerCase() === String(wallet).toLowerCase());
  const solPaid = list.reduce((sum, p) => sum + Number(p.solAmount || 0), 0);
  const purchasedTokens = list.reduce((sum, p) => sum + Number(p.tokenAmount || 0), 0);
  return { wallet, tokenSymbol: CFG.tokenSymbol, solPaid, purchasedTokens, purchases: list };
}

function tokenInfo(totalRaisedSol = 0) {
  const tier = getPriceTier(totalRaisedSol);
  return {
    symbol: CFG.tokenSymbol,
    totalSupply: CFG.totalSupply,
    presaleAllocationPercent: CFG.presaleAllocationPercent,
    presaleAllocationTokens: (CFG.totalSupply * CFG.presaleAllocationPercent) / 100,
    teamAllocationPercent: CFG.teamPercent,
    teamAllocationTokens: (CFG.totalSupply * CFG.teamPercent) / 100,
    presalePriceUsd: CFG.presalePriceUsd,
    currentPriceUsd: tier.current.priceUsd,
    listingPriceUsd: CFG.listingPriceUsd,
    solPriceUsd: liveSolPriceUsd || CFG.fallbackSolPriceUsd,
    blockchain: 'Solana',
    maxContributionSol: CFG.maxWalletCapSol,
    maxContributionUsd: CFG.maxWalletCapSol * (liveSolPriceUsd || CFG.fallbackSolPriceUsd),
    softCapSol: CFG.softCapSol,
    hardCapSol: CFG.hardCapSol,
    teamCliffMonths: CFG.teamCliffMonths,
    teamVestingMonths: CFG.teamVestingMonths,
    currentTier: tier.current,
    nextTier: tier.next,
    priceTiers: tier.tiers,
  };
}

async function getParsedTx(signature) {
  for (let i = 0; i < 20; i++) {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Transaction not found yet. Wait 10 seconds and click Check My DMOON Balance.');
}

function allInstructions(tx) {
  const out = [...(tx.transaction.message.instructions || [])];
  for (const inner of tx.meta?.innerInstructions || []) out.push(...inner.instructions);
  return out;
}

async function verifySolPayment({ wallet, amount, signature }) {
  const tx = await getParsedTx(signature);
  if (tx.meta?.err) throw new Error('Transaction failed on-chain');

  const expectedLamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
  const found = allInstructions(tx).find((ix) => {
    if (!ix.parsed || ix.program !== 'system' || ix.parsed.type !== 'transfer') return false;
    const info = ix.parsed.info || {};
    return (
      String(info.source) === String(wallet) &&
      String(info.destination) === String(CFG.treasuryWallet) &&
      Number(info.lamports || 0) >= expectedLamports
    );
  });

  if (!found) throw new Error(`SOL transfer to treasury not found. Expected ${amount} SOL.`);
  return { slot: tx.slot, blockTime: tx.blockTime || null };
}

app.get('/health', (req, res) => res.json({ ok: true, backend: 'DesertMoon SOL-only', rpc: CFG.rpcUrl }));

app.get('/stats', async (req, res) => {
  try {
    await getLiveSolPriceUsd();
    const db = loadDb();
    const t = totals(db);
    res.json({ token: tokenInfo(t.totalRaisedSol), totals: t });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/balance/:wallet', (req, res) => {
  try {
    res.json(walletTotals(loadDb(), req.params.wallet));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/register-purchase', async (req, res) => {
  try {
    const wallet = String(req.body.wallet || '').trim();
    const amount = Number(req.body.amount || 0);
    const signature = String(req.body.txSignature || req.body.signature || '').trim();

    if (!wallet) throw new Error('Missing wallet');
    if (!amount || amount <= 0) throw new Error('Invalid amount');
    if (!signature) throw new Error('Missing transaction signature');

    new PublicKey(wallet);
    new PublicKey(CFG.treasuryWallet);

    const db = loadDb();
    const duplicate = db.purchases.find((p) => p.txSignature === signature);
    if (duplicate) {
      return res.json({
        ok: true,
        success: true,
        alreadyRegistered: true,
        purchase: duplicate,
        balance: walletTotals(db, wallet),
        totals: totals(db),
      });
    }

    const currentWallet = walletTotals(db, wallet);
    if (currentWallet.solPaid + amount > CFG.maxWalletCapSol + 0.000001) {
      throw new Error(`Maximum contribution is ${CFG.maxWalletCapSol} SOL per wallet.`);
    }

    const totalBefore = totals(db).totalRaisedSol;
    if (totalBefore + amount > CFG.hardCapSol) throw new Error('Hard cap reached');

    const verification = await verifySolPayment({ wallet, amount, signature });
    const solPriceUsd = await getLiveSolPriceUsd();
    const tier = getPriceTier(totalBefore).current;
    const usdValue = amount * solPriceUsd;
    const tokenAmount = usdValue / tier.priceUsd;

    const purchase = {
      wallet,
      asset: 'SOL',
      amount,
      solAmount: amount,
      txSignature: signature,
      solPriceUsd,
      tokenPriceUsd: tier.priceUsd,
      usdValue,
      tokenAmount,
      slot: verification.slot,
      blockTime: verification.blockTime,
      createdAt: new Date().toISOString(),
    };

    db.purchases.push(purchase);
    saveDb(db);

    res.json({
      ok: true,
      success: true,
      purchase,
      balance: walletTotals(db, wallet),
      totals: totals(db),
      token: tokenInfo(totals(db).totalRaisedSol),
    });
  } catch (e) {
    console.error('Register purchase failed:', e);
    res.status(400).json({ error: e.message, success: false });
  }
});


app.get('/latest-blockhash', async (req, res) => {
  try {
    const latest = await connection.getLatestBlockhash('confirmed');
    res.json(latest);
  } catch (e) {
    console.error('latest-blockhash failed:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/send-signed-transaction', async (req, res) => {
  try {
    const signedTransaction = String(req.body.signedTransaction || '').trim();
    if (!signedTransaction) throw new Error('Missing signed transaction');

    const raw = Buffer.from(signedTransaction, 'base64');

    const signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5,
    });

    res.json({ ok: true, signature });
  } catch (e) {
    console.error('send-signed-transaction failed:', e);
    res.status(400).json({ error: e.message });
  }
});


app.listen(PORT, () => console.log(`DesertMoon SOL-only backend running on http://localhost:${PORT}`));
