# Polymarket Research for Octane Ajax Expansion

## What is Polymarket?
Polymarket is the world's largest prediction market platform, built on Polygon (crypto). Users trade on the outcomes of real-world events (politics, sports, crypto, culture). Markets are priced 0-100 cents, representing probability. Buy at 60 cents, event happens, you get $1. Profit = 40 cents.

## API & Technical Feasibility
- **Full API available** (docs.polymarket.com)
- Three APIs: Gamma (market data), Data (positions/trades), CLOB (order execution)
- Official SDKs in TypeScript, Python, and Rust
- CLOB API supports: Limit orders, Market orders, FOK, GTC
- Authentication: EOA wallet signature (Polygon)
- Requires a Polygon wallet funded with USDC.e
- **Polymarket even has an official open-source AI agent repo:** github.com/Polymarket/agents

## Legal Status (Critical for US Users)
- **Polymarket is NOT fully legal for US residents as of May 2026**
- In 2022, parent company Blockratize was fined $1.4M by CFTC for operating unregistered
- US users have been banned from the main platform since 2022
- As of April 28, 2026: Polymarket is actively seeking CFTC approval to reopen to US traders
- An "Amended Order of Designation" was issued permitting an intermediated trading platform
- **Status: In negotiation, not yet resolved**
- Alternative: Kalshi is CFTC-regulated and legal for US users

## Realistic Profitability Assessment
Source: Reddit review from 4-month bot operator + Yahoo Finance

### What works:
1. **Cross-platform arbitrage** (Polymarket ↔ Kalshi): Most consistent edge, but requires speed
2. **Sentiment/news-driven bots**: Monitor news, detect before crowd, enter positions. Edge degrades as more bots compete
3. **Near-resolution market sniping**: Contracts at 85-94 cents near resolution have asymmetric dynamics
4. **Copy trading**: Following high-win-rate wallets (75% accuracy documented)

### Realistic numbers:
- Average profit per arbitrage opportunity: $5-$15
- Running cost: $5-$50/day in API + on-chain fees
- One specific BTC 15-min up/down bot: documented 98% win rate with $4K-5K positions
- General "AI analyzes news and trades everything" approach: INCONSISTENT results

### Key risks:
- "The $115K week that brought everyone to bot trading? That trader posted the drawdown too. It just didn't go viral."
- Same strategy that made $115K was down 40% the following month
- Bloomberg: "most users lose money while bulk of profits go to a narrow slice of high-frequency bots"
- Well-capitalized, low-latency competition has captured most obvious arbitrage
- Strategies that work in February can fail in March

## How This Maps to Octane Ajax Architecture

The Nova → Forge → Review Gate → Pixel pipeline maps remarkably well:

| Etsy Pipeline | Polymarket Pipeline |
|--------------|-------------------|
| Nova scouts trends/niches | Nova scouts markets with mispriced probabilities |
| Forge creates listing content | Forge generates trade thesis + position sizing |
| Review Gate (human approves) | Review Gate (human approves trade before execution) |
| Pixel does marketing/SEO | Pixel monitors news feeds for sentiment signals |
| Etsy API pushes draft listing | CLOB API executes approved trades |

The key architectural insight: **The same agent loop works for both use cases.** The agents just need different "modes" or "modules" they can be configured to run.

## Recommended Approach for Octane Ajax

### Phase 4 (Future): Prediction Market Module
- Add a "Trading Mode" alongside the existing "Commerce Mode"
- Nova becomes a market scanner (using Gamma API to find mispriced markets)
- Forge becomes a trade thesis generator (LLM analyzes news + market data → structured trade recommendation)
- Review Gate stays the same (human approves/rejects trades)
- New: "Executor" agent replaces Pixel, handles CLOB API order placement
- Start with Kalshi (legal for US) rather than Polymarket until CFTC resolves
- Start with paper trading / small positions ($50-100 max per trade)
- Implement hard risk controls: max daily loss, max exposure, kill switch

### Capital Requirements:
- Minimum to start meaningfully: $500-$1,000 in USDC
- This is SEPARATE from the $200-300 Etsy budget
- Recommendation: Fund this from Etsy profits, not from initial capital

### Why This Makes Octane Ajax More Valuable as Future SaaS:
- "AI-powered autonomous business engine" that can run BOTH commerce and trading
- Differentiates from every other Etsy automation tool
- The agent architecture (research → create → review → execute) is universal
