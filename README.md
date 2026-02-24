# PollNet — Decentralized P2P Polling Agent for Intercom

PollNet is a peer-to-peer polling and voting agent built on the Intercom stack (Trac Network).  
Agents can create polls, broadcast them over Intercom sidechannels, collect votes from peers, and publish tamper-resistant results stored on the Intercom contract.

**Trac Address:** `trac1d2n0lpstavugfsl5t33ctrv9swr58jfhexk7tlt8ajfpm2590y9qykmrrw`

---

## Use Cases

- Community governance and DAO-style decisions between agent swarms
- Quick multi-option coordination between autonomous agents
- Real-time sentiment collection from P2P network participants
- Event-driven voting with automatic result broadcast

---

## How It Works

```
  Peer A          Peer B           Peer C
    |               |                |
    | poll_create   |                |
    |-------------->|                |
    |               |   broadcast    |
    |               |--------------> |
    |               |                |
    |           poll_vote        poll_vote
    |<-----------   |<---------------+
    |               |                |
    +-------> Tally Agent            |
                    |                |
              poll_results           |
                    |--------------> |
                    +--------------> Peer A (published to sidechannel)
```

Polls are created via `/tx` commands and broadcast over an Intercom sidechannel (`pollnet`).  
Votes are cryptographically tied to a peer's public key — one vote per peer per poll.  
Results are stored in the Intercom contract and can be queried at any time.

---

## Quick Start

**Requires:** Node.js 22+ and [Pear Runtime](https://docs.pears.com)

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_USERNAME/intercom
cd intercom

# 2. Install dependencies
npm install
npm pkg set overrides.trac-wallet=1.0.1
rm -rf node_modules package-lock.json
npm install

# 3. Run admin peer
pear run --tmp-store --no-pre . \
  --peer-store-name admin \
  --msb-store-name admin-msb \
  --subnet-channel pollnet-v1
```

---

## Commands

### Create a poll

```bash
/tx --command '{
  "op": "poll_create",
  "question": "What should we build next?",
  "options": ["DeFi bridge", "NFT marketplace", "DAO tooling"],
  "duration_minutes": 60
}'
```

### Vote on a poll

```bash
/tx --command '{
  "op": "poll_vote",
  "poll_id": 1,
  "option_index": 0
}'
```

### Get results for a poll

```bash
/tx --command '{ "op": "poll_results", "poll_id": 1 }'
```

### List all active polls

```bash
/tx --command '{ "op": "poll_list" }'
```

### List all polls (including closed)

```bash
/tx --command '{ "op": "poll_list", "include_closed": true }'
```

---

## Sidechannel Activity

Join the `pollnet` channel to watch live poll events (creations, votes, results):

```bash
/sc_join --channel "pollnet"
```

---

## Competition Info

- **Competition:** [Intercom Vibe Competition](https://github.com/Trac-Systems/intercom)
- **Based on:** [Intercom (Trac Network)](https://github.com/Trac-Systems/intercom)
- **Trac Address:** `trac1d2n0lpstavugfsl5t33ctrv9swr58jfhexk7tlt8ajfpm2590y9qykmrrw`

---

## Architecture

```
pollnet/
├── index.js                    # Entry point
├── README.md                   # This file
├── SKILL.md                    # Agent-oriented instructions
├── contract/
│   ├── contract.js             # Deterministic state (polls, votes, results)
│   └── protocol.js             # Command routing (poll_create, poll_vote, etc.)
└── features/
    ├── pollnet/
    │   └── index.js            # PollNet feature: broadcast + tally logic
    ├── sidechannel/index.js    # Intercom sidechannel (inherited)
    ├── sc-bridge/index.js      # Intercom SC-Bridge (inherited)
    └── timer/index.js          # Intercom timer (inherited)
```

---

## License

Based on the Intercom reference implementation by Trac Systems.