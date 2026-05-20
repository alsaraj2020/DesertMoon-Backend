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

const treasuryPublicKey = new PublicKey(
  CFG.treasuryWallet
);

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

async function getAllPurchases() {
  const signatures =
    await connection.getSignaturesForAddress(
      treasuryPublicKey,
      { limit: 1000 }
    );

  const purchases = [];

  for (const sig of signatures) {
    try {
      const tx =
        await connection.getParsedTransaction(
          sig.signature,
          {
            maxSupportedTransactionVersion: 0,
          }
        );

      if (!tx) continue;

      const instructions =
        tx.transaction.message.instructions || [];

      for (const ix of instructions) {
        if (
          ix.program === 'system' &&
          ix.parsed?.type === 'transfer'
        ) {
          const info = ix.parsed.info;

          if (
            info.destination ===
            CFG.treasuryWallet
          ) {
            const solAmount =
              Number(info.lamports) /
              LAMPORTS_PER_SOL;

            const solPriceUsd =
              await getLiveSolPriceUsd();

            const totalBefore =
              purchases.reduce(
                (sum, p) => sum + p.solAmount,
                0
              );

            const tier =
              getPriceTier(totalBefore).current;

            const usdValue =
              solAmount * solPriceUsd;

            const tokenAmount =
              usdValue / tier.priceUsd;

            purchases.push({
              wallet: info.source,
              solAmount,
              tokenAmount,
              txSignature: sig.signature,
            });
          }
        }
      }
    } catch {}
  }

  return purchases;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
  });
});

app.get('/stats', async (req, res) => {
  try {
    const purchases =
      await getAllPurchases();

    const totalRaisedSol =
      purchases.reduce(
        (sum, p) => sum + p.solAmount,
        0
      );

    const percentFunded =
      (totalRaisedSol / CFG.hardCapSol) * 100;

    const tierData =
      getPriceTier(totalRaisedSol);

    res.json({
      totals: {
        totalRaisedSol,
        percentFunded,
        hardCapSol: CFG.hardCapSol,
      },

      token: {
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
          (CFG.totalSupply *
            CFG.teamPercent) /
          100,

        presalePriceUsd:
          CFG.presalePriceUsd,

        currentPriceUsd:
          tierData.current.priceUsd,

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
          tierData.current,

        nextTier:
          tierData.next,

        priceTiers:
          tierData.tiers,
      },
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
    const wallet =
      String(req.params.wallet);

    const purchases =
      await getAllPurchases();

    const mine = purchases.filter(
      (p) =>
        p.wallet.toLowerCase() ===
        wallet.toLowerCase()
    );

    const solPaid =
      mine.reduce(
        (sum, p) => sum + p.solAmount,
        0
      );

    const purchasedTokens =
      mine.reduce(
        (sum, p) => sum + p.tokenAmount,
        0
      );

    res.json({
      wallet,
      tokenSymbol:
        CFG.tokenSymbol,

      solPaid,

      purchasedTokens,
    });
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
      res.json({
        success: true,
      });
    } catch (e) {
      res.status(400).json({
        error: e.message,
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(
    `DesertMoon backend running on port ${PORT}`
  );
});
