# PollNet SKILL — Agent-Oriented Instructions

This file is the authoritative guide for any AI agent or human operator setting up and running **PollNet** on the Intercom stack.

---

## What is PollNet?

PollNet is a P2P polling and voting agent built on Intercom (Trac Network).  
It allows autonomous agents and human peers to:

- Create multi-option polls broadcast over a sidechannel
- Vote on polls (one vote per peer per poll, enforced by contract)
- Query live and final results stored deterministically on-chain
- Auto-close polls after a configurable duration and broadcast final results

---

## Runtime Requirement

**Always use Pear runtime. Never run with native `node`.**

```bash
# Install Pear globally (once)
npm install -g pear
```

---

## First-Run Setup

```bash
git clone https://github.com/YOUR_USERNAME/intercom
cd intercom
npm install
npm pkg set overrides.trac-wallet=1.0.1
rm -rf node_modules package-lock.json
npm install
```

---

## Running the Admin Peer

The admin peer initializes the subnet and contract. Run this first:

```bash
pear run --tmp-store --no-pre . \
  --peer-store-name admin \
  --msb-store-name admin-msb \
  --subnet-channel pollnet-v1
```

After startup, the admin peer prints a `subnet-bootstrap` hex string. Save it — other peers need it.

---

## Joining as a Second Peer

```bash
pear run --tmp-store --no-pre . \
  --peer-store-name peer2 \
  --msb-store-name peer2-msb \
  --subnet-channel pollnet-v1 \
  --subnet-bootstrap <HEX_FROM_ADMIN>
```

---

## Command Reference

All commands are sent via `/tx --command '<JSON>'`.

### poll_create

Create a new poll. Only the admin peer (contract owner) can create polls by default.

```json
{
  "op": "poll_create",
  "question": "String — the poll question (max 280 chars)",
  "options": ["Option A", "Option B", "Option C"],
  "duration_minutes": 60
}
```

- `options`: 2–8 strings, each max 100 chars
- `duration_minutes`: 1–10080 (1 week max). Omit for no auto-close.
- Returns: `{ "ok": true, "poll_id": <number> }`

### poll_vote

Cast a vote on an open poll.

```json
{
  "op": "poll_vote",
  "poll_id": 1,
  "option_index": 0
}
```

- `option_index`: 0-based index into the options array
- One vote per peer public key per poll (enforced by contract)
- Returns: `{ "ok": true }` or `{ "error": "already_voted" }`

### poll_results

Get current or final results for a poll.

```json
{
  "op": "poll_results",
  "poll_id": 1
}
```

Returns:
```json
{
  "poll_id": 1,
  "question": "What should we build next?",
  "status": "open",
  "options": ["DeFi bridge", "NFT marketplace", "DAO tooling"],
  "votes": [5, 3, 2],
  "total": 10,
  "winner": "DeFi bridge",
  "created_at": 1700000000000,
  "closes_at": 1700003600000
}
```

### poll_list

List polls.

```json
{ "op": "poll_list" }
```

Add `"include_closed": true` to include closed polls.

---

## Sidechannel Events

PollNet broadcasts events to the `pollnet` sidechannel automatically:

| Event | When |
|-------|------|
| `POLL_CREATED` | New poll is opened |
| `POLL_VOTE` | A vote is cast (shows running totals) |
| `POLL_CLOSED` | Poll duration expires; final result broadcast |

To watch live:
```bash
/sc_join --channel "pollnet"
```

---

## Contract State Shape

The Intercom contract stores PollNet state deterministically:

```json
{
  "polls": {
    "1": {
      "id": 1,
      "question": "...",
      "options": ["A", "B", "C"],
      "votes": [0, 0, 0],
      "voters": {},
      "status": "open",
      "created_at": 1700000000000,
      "closes_at": 1700003600000
    }
  },
  "next_poll_id": 2
}
```

`voters` is a map of `{ [publicKey]: option_index }` — prevents double-voting.

---

## Common Issues

| Problem | Fix |
|---------|-----|
| `already_voted` error | Each peer key can only vote once per poll |
| Poll not found | Check `poll_id` with `/tx --command '{"op":"poll_list","include_closed":true}'` |
| Commands not reaching peers | Ensure all peers share the same `--subnet-channel` value |
| Pear not found | Run `npm install -g pear` first |

---

## Agent Integration Tips

- Agents should subscribe to the `pollnet` sidechannel to receive real-time events
- Use `poll_list` on startup to sync current state
- `poll_results` is safe to call repeatedly (read-only, no state change)
- Agents can automate voting based on their own logic by sending `poll_vote` commands