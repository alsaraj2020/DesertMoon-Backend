import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);

const CFG = {
  rpcUrl:
    process.env.RPC_URL ||
    'https://api.mainnet-beta.solana.com',

  treasuryWallet:
    process.env.TREASURY_WALLET ||
    '9JVtaDxzymteMrTKNGhsyGcNqsFfY7ce3LqdXhij4McC',

  tokenSymbol:
    process.env.TOKEN_SYMBOL || 'DMOON',

  totalSupply:
    Number(process.env.TOTAL_SUPPLY || 1000000000),

  presaleAllocationPercent:
    Number(
      process.env.PRESALE_ALLOCATION_PERCENT || 30
    ),

  teamPercent:
    Number(process.env.TEAM_PERCENT || 10),

  presalePriceUsd:
    Number(process.env.PRESALE_PRICE_USD || 0.005),

  listingPriceUsd:
    Number(process.env.LISTING_PRICE_USD || 0.05),

  fallbackSolPriceUsd:
    Number(process.env.SOL_PRICE_USD || 150),

  maxWalletCapSol:
    Number(process.env.MAX_WALLET_CAP_SOL || 50),

  softCapSol:
    Number(process.env.SOFT_CAP_SOL || 15000),

  hardCapSol:
    Number(process.env.HARD_CAP_SOL || 75000),

  teamCliffMonths:
    Number(process.env.TEAM_CLIFF_MONTHS || 11),

  teamVestingMonths:
    Number(process.env.TEAM_VESTING_MONTHS || 18),
};

const connection = new Connection(
  CFG.rpcUrl,
  'confirmed'
);

const DATA_DIR = path.join(process.cwd(), 'data');

const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ purchases: [] }, null, 2)
    );
  }
}

function loadDb() {
  ensureDb();

  return JSON.parse(
    fs.readFileSync(DB_FILE, 'utf8')
  );
}

function saveDb(db) {
  ensureDb();

  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}

let liveSolPriceUsd = CFG.fallbackSolPriceUsd;

async function getLiveSolPriceUsd() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );

    const data = await res.json();

    const price = Number(data?.solana?.usd);

    if (price > 0) {
      liveSolPriceUsd = price;
    }
  } catch {}

  return liveSolPriceUsd;
}

function getPriceTier(totalRaisedSol) {
  const tiers = [
    {
      name: 'Tier 1',
      minRaisedSol: 0,
      maxRaisedSol: 11250,
      priceUsd: 0.005,
      allocation: '15%',
    },

    {
      name: 'Tier 2',
      minRaisedSol: 11250,
      maxRaisedSol: 26250,
      priceUsd: 0.01,
      allocation: '20%',
    },

    {
      name: 'Tier 3',
      minRaisedSol: 26250,
      maxRaisedSol: 45000,
      priceUsd: 0.02,
      allocation: '25%',
    },

    {
      name: 'Tier 4',
      minRaisedSol: 45000,
      maxRaisedSol: 75000,
      priceUsd: 0.035,
      allocation: '40%',
    },
  ];

  const current =
    tiers.find(
      (t) =>
        totalRaisedSol >= t.minRaisedSol &&
        totalRaisedSol < t.maxRaisedSol
    ) || tiers[tiers.length - 1];

  const next =
    tiers.find(
      (t) => t.minRaisedSol > totalRaisedSol
    ) || null;

  return {
    tiers,
    current,
    next,
  };
}

function totals(db) {
  const totalRaisedSol =
    db.purchases.reduce(
      (sum, p) => sum + Number(p.solAmount || 0),
      0
    );

  return {
    totalRaisedSol,

    hardCapSol: CFG.hardCapSol,

    percentFunded:
      CFG.hardCapSol > 0
        ? (totalRaisedSol / CFG.hardCapSol) * 100
        : 0,
  };
}

function walletTotals(db, wallet) {
  const list = db.purchases.filter(
    (p) =>
      String(p.wallet).toLowerCase() ===
      String(wallet).toLowerCase()
  );

  const solPaid =
    list.reduce(
      (sum, p) => sum + Number(p.solAmount || 0),
      0
    );

  const purchasedTokens =
    list.reduce(
      (sum, p) => sum + Number(p.tokenAmount || 0),
      0
    );

  return {
    wallet,

    tokenSymbol: CFG.tokenSymbol,

    solPaid,

    purchasedTokens,
  };
}

function tokenInfo(totalRaisedSol = 0) {
  const tier = getPriceTier(totalRaisedSol);

  return {
    symbol: CFG.tokenSymbol,

    totalSupply: CFG.totalSupply,

    presaleAllocationPercent:
      CFG.presaleAllocationPercent,

    presaleAllocationTokens:
      (CFG.totalSupply *
        CFG.presaleAllocationPercent) /
      100,

    teamAllocationPercent:
      CFG.teamPercent,

    teamAllocationTokens:
      (CFG.totalSupply * CFG.teamPercent) /
      100,

    presalePriceUsd:
      CFG.presalePriceUsd,

    currentPriceUsd:
      tier.current.priceUsd,

    listingPriceUsd:
      CFG.listingPriceUsd,

    solPriceUsd:
      liveSolPriceUsd,

    blockchain: 'Solana',

    maxContributionSol:
      CFG.maxWalletCapSol,

    softCapSol:
      CFG.softCapSol,

    hardCapSol:
      CFG.hardCapSol,

    teamCliffMonths:
      CFG.teamCliffMonths,

    teamVestingMonths:
      CFG.teamVestingMonths,

    currentTier:
      tier.current,

    nextTier:
      tier.next,

    priceTiers:
      tier.tiers,
  };
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
  });
});

app.get('/stats', async (req, res) => {
  try {
    await getLiveSolPriceUsd();

    const db = loadDb();

    const t = totals(db);

    res.json({
      totals: t,

      token: tokenInfo(
        t.totalRaisedSol
      ),
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: e.message,
    });
  }
});

app.get('/balance/:wallet', async (req, res) => {
  try {
    const db = loadDb();

    res.json(
      walletTotals(
        db,
        req.params.wallet
      )
    );
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: e.message,
    });
  }
});

app.post(
  '/register-purchase',
  async (req, res) => {
    try {
      const wallet = String(
        req.body.wallet || ''
      ).trim();

      const amount = Number(
        req.body.amount || 0
      );

      const signature = String(
        req.body.txSignature ||
          req.body.signature ||
          ''
      ).trim();

      if (!wallet) {
        throw new Error('Missing wallet');
      }

      if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
      }

      if (!signature) {
        throw new Error(
          'Missing transaction signature'
        );
      }

      const db = loadDb();

      const duplicate =
        db.purchases.find(
          (p) =>
            p.txSignature === signature
        );

      if (duplicate) {
        return res.json({
          success: true,
          alreadyRegistered: true,
        });
      }

      const solPriceUsd =
        await getLiveSolPriceUsd();

      const totalBefore =
        totals(db).totalRaisedSol;

      const tier =
        getPriceTier(totalBefore).current;

      const usdValue =
        amount * solPriceUsd;

      const tokenAmount =
        usdValue / tier.priceUsd;

      const purchase = {
        wallet,

        solAmount: amount,

        tokenAmount,

        txSignature: signature,

        createdAt:
          new Date().toISOString(),
      };

      db.purchases.push(purchase);

      saveDb(db);

      res.json({
        success: true,

        purchase,
      });
    } catch (e) {
      console.error(e);

      res.status(400).json({
        error: e.message,
      });
    }
  }
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `DesertMoon backend running on port ${PORT}`
  );
});
