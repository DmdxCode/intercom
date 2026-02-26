import {Protocol} from "trac-peer";
import { bufferToBigInt, bigIntToDecimalString } from "trac-msb/src/utils/amountSerialization.js";
import b4a from "b4a";
import PeerWallet from "trac-wallet";
import fs from "fs";

const stableStringify = (value) => {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const normalizeInvitePayload = (payload) => {
    return {
        channel: String(payload?.channel ?? ''),
        inviteePubKey: String(payload?.inviteePubKey ?? '').trim().toLowerCase(),
        inviterPubKey: String(payload?.inviterPubKey ?? '').trim().toLowerCase(),
        inviterAddress: payload?.inviterAddress ?? null,
        issuedAt: Number(payload?.issuedAt),
        expiresAt: Number(payload?.expiresAt),
        nonce: String(payload?.nonce ?? ''),
        version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
};

const normalizeWelcomePayload = (payload) => {
    return {
        channel: String(payload?.channel ?? ''),
        ownerPubKey: String(payload?.ownerPubKey ?? '').trim().toLowerCase(),
        text: String(payload?.text ?? ''),
        issuedAt: Number(payload?.issuedAt),
        version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
};

const parseInviteArg = (raw) => {
    if (!raw) return null;
    let text = String(raw || '').trim();
    if (!text) return null;
    if (text.startsWith('@')) {
        try { text = fs.readFileSync(text.slice(1), 'utf8').trim(); } catch (_e) { return null; }
    }
    if (text.startsWith('b64:')) text = text.slice(4);
    if (text.startsWith('{')) { try { return JSON.parse(text); } catch (_e) {} }
    try { const decoded = b4a.toString(b4a.from(text, 'base64')); return JSON.parse(decoded); } catch (_e) {}
    return null;
};

const parseWelcomeArg = (raw) => {
    if (!raw) return null;
    let text = String(raw || '').trim();
    if (!text) return null;
    if (text.startsWith('@')) {
        try { text = fs.readFileSync(text.slice(1), 'utf8').trim(); } catch (_e) { return null; }
    }
    if (text.startsWith('b64:')) text = text.slice(4);
    if (text.startsWith('{')) { try { return JSON.parse(text); } catch (_e) {} }
    try { const decoded = b4a.toString(b4a.from(text, 'base64')); return JSON.parse(decoded); } catch (_e) {}
    return null;
};

// ─── PollNet State ────────────────────────────────────────────────────────────

const pollState = {
    polls: {},
    next_poll_id: 1
};

const POLLNET_CHANNEL = 'pollnet';

const formatPoll = (poll) => {
    const total = poll.votes.reduce((s, v) => s + v, 0);
    let winner = null;
    if (total > 0) {
        const maxVotes = Math.max(...poll.votes);
        winner = poll.options[poll.votes.indexOf(maxVotes)];
    }
    return {
        poll_id: poll.id,
        question: poll.question,
        status: poll.status,
        options: poll.options,
        votes: poll.votes,
        total,
        winner,
        created_at: poll.created_at,
        closes_at: poll.closes_at
    };
};

// ─── Protocol ────────────────────────────────────────────────────────────────

class SampleProtocol extends Protocol {

    constructor(peer, base, options = {}) {
        super(peer, base, options);
        this._pollTicker = setInterval(() => this._tickPolls(), 15_000);
    }

    async extendApi() {
        this.api.getSampleData = function () {
            return 'Some sample data';
        }
    }

    mapTxCommand(command) {
        let obj = { type: '', value: null };

        if (command === 'something') {
            obj.type = 'storeSomething'; obj.value = null; return obj;
        } else if (command === 'read_snapshot') {
            obj.type = 'readSnapshot'; obj.value = null; return obj;
        } else if (command === 'read_chat_last') {
            obj.type = 'readChatLast'; obj.value = null; return obj;
        } else if (command === 'read_timer') {
            obj.type = 'readTimer'; obj.value = null; return obj;
        } else {
            const json = this.safeJsonParse(command);
            if (json.op === 'poll_create') { obj.type = 'pollCreate'; obj.value = json; return obj; }
            else if (json.op === 'poll_vote') { obj.type = 'pollVote'; obj.value = json; return obj; }
            else if (json.op === 'poll_results') { obj.type = 'pollResults'; obj.value = json; return obj; }
            else if (json.op === 'poll_list') { obj.type = 'pollList'; obj.value = json; return obj; }
            else if (json.op === 'do_something') { obj.type = 'submitSomething'; obj.value = json; return obj; }
            else if (json.op === 'read_key') { obj.type = 'readKey'; obj.value = json; return obj; }
            else if (json.op === 'read_chat_last') { obj.type = 'readChatLast'; obj.value = null; return obj; }
            else if (json.op === 'read_timer') { obj.type = 'readTimer'; obj.value = null; return obj; }
        }
        return null;
    }

    // ─── PollNet Logic ────────────────────────────────────────────────────────

    _broadcast(payload) {
        if (!this.peer.sidechannel) return;
        try { this.peer.sidechannel.broadcast(POLLNET_CHANNEL, JSON.stringify(payload)); } catch (_e) {}
    }

    _tickPolls() {
        const now = Date.now();
        for (const poll of Object.values(pollState.polls)) {
            if (poll.status === 'open' && poll.closes_at && now > poll.closes_at) {
                poll.status = 'closed';
                this._broadcast({ event: 'POLL_CLOSED', ...formatPoll(poll) });
            }
        }
    }

    _handlePollCreate(json, peer) {
        const { question, options, duration_minutes } = json;
        if (!question || typeof question !== 'string' || question.trim().length === 0) {
            console.log('[PollNet] Error: invalid question'); return;
        }
        if (!Array.isArray(options) || options.length < 2 || options.length > 8) {
            console.log('[PollNet] Error: options must be array of 2-8 items'); return;
        }
        let closes_at = null;
        if (duration_minutes !== undefined) {
            const dur = Number(duration_minutes);
            if (Number.isFinite(dur) && dur >= 1) closes_at = Date.now() + dur * 60 * 1000;
        }
        const id = pollState.next_poll_id++;
        pollState.polls[id] = {
            id, question: question.trim(),
            options: options.map(o => String(o).trim()),
            votes: new Array(options.length).fill(0),
            voters: {}, status: 'open',
            created_by: peer, created_at: Date.now(), closes_at
        };
        console.log(`[PollNet] ✅ Poll #${id} created: "${question.trim()}"`);
        console.log(`[PollNet] Options: ${options.join(', ')}`);
        if (closes_at) console.log(`[PollNet] Closes at: ${new Date(closes_at).toISOString()}`);
        this._broadcast({ event: 'POLL_CREATED', poll_id: id, question: question.trim(), options: options.map(o => String(o).trim()), closes_at });
    }

    _handlePollVote(json, peer) {
        const { poll_id, option_index } = json;
        const poll = pollState.polls[poll_id];
        if (!poll) { console.log(`[PollNet] Error: poll #${poll_id} not found`); return; }
        if (poll.status !== 'open') { console.log('[PollNet] Error: poll is closed'); return; }
        if (poll.closes_at && Date.now() > poll.closes_at) { poll.status = 'closed'; console.log('[PollNet] Error: poll expired'); return; }
        if (poll.voters[peer] !== undefined) { console.log('[PollNet] Error: already voted'); return; }
        const idx = Number(option_index);
        if (!Number.isFinite(idx) || idx < 0 || idx >= poll.options.length) { console.log('[PollNet] Error: invalid option_index'); return; }
        poll.voters[peer] = idx;
        poll.votes[idx]++;
        const total = poll.votes.reduce((s, v) => s + v, 0);
        console.log(`[PollNet] ✅ Vote recorded for "${poll.options[idx]}" (total votes: ${total})`);
        this._broadcast({ event: 'POLL_VOTE', poll_id, option: poll.options[idx], votes: [...poll.votes], total });
    }

    _handlePollResults(json) {
        const { poll_id } = json;
        const poll = pollState.polls[poll_id];
        if (!poll) { console.log(`[PollNet] Error: poll #${poll_id} not found`); return; }
        const result = formatPoll(poll);
        console.log(`[PollNet] 📊 Results for Poll #${poll_id}: "${result.question}"`);
        result.options.forEach((opt, i) => {
            const pct = result.total > 0 ? Math.round((result.votes[i] / result.total) * 100) : 0;
            const bar = '█'.repeat(Math.round(pct / 5));
            console.log(`  [${i}] ${opt}: ${result.votes[i]} vote(s) (${pct}%) ${bar}`);
        });
        console.log(`  Total: ${result.total} | Winner: ${result.winner || 'none yet'} | Status: ${result.status}`);
    }

    _handlePollList(json) {
        const { include_closed } = json;
        const polls = Object.values(pollState.polls)
            .filter(p => include_closed || p.status === 'open')
            .map(formatPoll);
        if (polls.length === 0) {
            console.log('[PollNet] No polls found.');
        } else {
            console.log(`[PollNet] 📋 ${polls.length} poll(s):`);
            polls.forEach(p => console.log(`  #${p.poll_id} [${p.status}] "${p.question}" — ${p.total} vote(s), winner: ${p.winner || 'TBD'}`));
        }
    }

    // ─── Terminal ─────────────────────────────────────────────────────────────

    async printOptions() {
        console.log(' ');
        console.log('╔══════════════════════════════════════════════════════════════════╗');
        console.log('║                     PollNet Commands                            ║');
        console.log('╠══════════════════════════════════════════════════════════════════╣');
        console.log('║ Create: /tx --command \'{"op":"poll_create","question":"?",      ║');
        console.log('║           "options":["A","B","C"],"duration_minutes":30}\'       ║');
        console.log('║ Vote:   /tx --command \'{"op":"poll_vote","poll_id":1,           ║');
        console.log('║           "option_index":0}\'                                    ║');
        console.log('║ Result: /tx --command \'{"op":"poll_results","poll_id":1}\'       ║');
        console.log('║ List:   /tx --command \'{"op":"poll_list"}\'                      ║');
        console.log('║ Watch:  /sc_join --channel "pollnet"                            ║');
        console.log('╚══════════════════════════════════════════════════════════════════╝');
        console.log(' ');
        console.log('- System Commands:');
        console.log('- /get --key "<key>" | reads subnet state key.');
        console.log('- /msb | prints MSB info.');
        console.log('- /sc_join --channel "<n>" | join sidechannel.');
        console.log('- /sc_send --channel "<n>" --message "<text>" | send to sidechannel.');
        console.log('- /sc_stats | show sidechannel stats.');
        console.log('- /print --text "<text>" | print text.');
    }

    async customCommand(input) {
        await super.tokenizeInput(input);

        // PollNet tx interception
        if (this.input.startsWith("/tx")) {
            const args = this.parseArgs(input);
            const command = args.command || args.cmd;
            if (command) {
                try {
                    const json = JSON.parse(command);
                    const peer = this.peer?.wallet?.publicKey || 'local';
                    if (json.op === 'poll_create') { this._handlePollCreate(json, peer); return; }
                    if (json.op === 'poll_vote') { this._handlePollVote(json, peer); return; }
                    if (json.op === 'poll_results') { this._handlePollResults(json); return; }
                    if (json.op === 'poll_list') { this._handlePollList(json); return; }
                } catch (_e) {}
            }
        }

        if (this.input.startsWith("/get")) {
            const m = input.match(/(?:^|\s)--key(?:=|\s+)(\"[^\"]+\"|'[^']+'|\S+)/);
            const raw = m ? m[1].trim() : null;
            if (!raw) { console.log('Usage: /get --key "<key>"'); return; }
            const key = raw.replace(/^\"(.*)\"$/, "$1").replace(/^'(.*)'$/, "$1");
            const confirmedMatch = input.match(/(?:^|\s)--confirmed(?:=|\s+)(\S+)/);
            const unconfirmedMatch = input.match(/(?:^|\s)--unconfirmed(?:=|\s+)?(\S+)?/);
            const confirmed = unconfirmedMatch ? false : confirmedMatch ? confirmedMatch[1] === "true" || confirmedMatch[1] === "1" : true;
            const v = confirmed ? await this.getSigned(key) : await this.get(key);
            console.log(v);
            return;
        }
        if (this.input.startsWith("/msb")) {
            const txv = await this.peer.msbClient.getTxvHex();
            const peerMsbAddress = this.peer.msbClient.pubKeyHexToAddress(this.peer.wallet.publicKey);
            const entry = await this.peer.msbClient.getNodeEntryUnsigned(peerMsbAddress);
            const balance = entry?.balance ? bigIntToDecimalString(bufferToBigInt(entry.balance)) : 0;
            const feeBuf = this.peer.msbClient.getFee();
            const fee = feeBuf ? bigIntToDecimalString(bufferToBigInt(feeBuf)) : 0;
            const validators = this.peer.msbClient.getConnectedValidatorsCount();
            console.log({ networkId: this.peer.msbClient.networkId, msbBootstrap: this.peer.msbClient.bootstrapHex, txv, msbSignedLength: this.peer.msbClient.getSignedLength(), msbUnsignedLength: this.peer.msbClient.getUnsignedLength(), connectedValidators: validators, peerMsbAddress, peerMsbBalance: balance, msbFee: fee });
            return;
        }
        if (this.input.startsWith("/sc_join")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            if (!name) { console.log('Usage: /sc_join --channel "<n>"'); return; }
            if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
            let invite = null; let welcome = null;
            const inviteArg = args.invite || args.invite_b64;
            const welcomeArg = args.welcome || args.welcome_b64;
            if (inviteArg) invite = parseInviteArg(inviteArg);
            if (welcomeArg) welcome = parseWelcomeArg(welcomeArg);
            if (invite || welcome) this.peer.sidechannel.acceptInvite(String(name), invite, welcome);
            const ok = await this.peer.sidechannel.addChannel(String(name));
            if (!ok) { console.log('Join denied.'); return; }
            console.log('Joined sidechannel:', name);
            return;
        }
        if (this.input.startsWith("/sc_send")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const message = args.message || args.msg;
            if (!name || message === undefined) { console.log('Usage: /sc_send --channel "<n>" --message "<text>"'); return; }
            if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
            const ok = await this.peer.sidechannel.addChannel(String(name));
            if (!ok) { console.log('Send denied.'); return; }
            this.peer.sidechannel.broadcast(String(name), message);
            return;
        }
        if (this.input.startsWith("/sc_open")) {
            const args = this.parseArgs(input);
            const name = args.channel || args.ch || args.name;
            const via = args.via;
            if (!name) { console.log('Usage: /sc_open --channel "<n>" [--via "<channel>"]'); return; }
            if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
            const viaChannel = via || this.peer.sidechannel.entryChannel || null;
            if (!viaChannel) { console.log('No entry channel. Pass --via "<channel>".'); return; }
            this.peer.sidechannel.requestOpen(String(name), String(viaChannel));
            console.log('Requested channel:', name);
            return;
        }
        if (this.input.startsWith("/sc_invite")) {
            const args = this.parseArgs(input);
            const channel = args.channel || args.ch || args.name;
            const invitee = args.pubkey || args.invitee || args.peer || args.key;
            const ttlRaw = args.ttl;
            if (!channel || !invitee) { console.log('Usage: /sc_invite --channel "<n>" --pubkey "<hex>" [--ttl <sec>]'); return; }
            if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
            const walletPub = this.peer?.wallet?.publicKey;
            const inviterPubKey = walletPub ? (typeof walletPub === 'string' ? walletPub.trim().toLowerCase() : b4a.toString(walletPub, 'hex')) : null;
            if (!inviterPubKey) { console.log('Wallet not ready.'); return; }
            let inviterAddress = null;
            try { if (this.peer?.msbClient) inviterAddress = this.peer.msbClient.pubKeyHexToAddress(inviterPubKey); } catch (_e) {}
            const issuedAt = Date.now();
            const ttlMs = ttlRaw ? Number.parseInt(String(ttlRaw), 10) * 1000 : 604800000;
            const expiresAt = issuedAt + ttlMs;
            const payload = normalizeInvitePayload({ channel: String(channel), inviteePubKey: String(invitee).trim().toLowerCase(), inviterPubKey, inviterAddress, issuedAt, expiresAt, nonce: Math.random().toString(36).slice(2, 10), version: 1 });
            const msgBuf = b4a.from(stableStringify(payload));
            let sig = this.peer.wallet.sign(msgBuf);
            let sigHex = typeof sig === 'string' ? sig : (sig?.length > 0 ? b4a.toString(sig, 'hex') : '');
            const invite = { payload, sig: sigHex };
            console.log(JSON.stringify(invite));
            console.log('invite_b64:', b4a.toString(b4a.from(JSON.stringify(invite)), 'base64'));
            return;
        }
        if (this.input.startsWith("/sc_welcome")) {
            const args = this.parseArgs(input);
            const channel = args.channel || args.ch || args.name;
            const text = args.text || args.message || args.msg;
            if (!channel || text === undefined) { console.log('Usage: /sc_welcome --channel "<n>" --text "<message>"'); return; }
            if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
            const walletPub = this.peer?.wallet?.publicKey;
            const ownerPubKey = walletPub ? (typeof walletPub === 'string' ? walletPub.trim().toLowerCase() : b4a.toString(walletPub, 'hex')) : null;
            if (!ownerPubKey) { console.log('Wallet not ready.'); return; }
            const payload = normalizeWelcomePayload({ channel: String(channel), ownerPubKey, text: String(text), issuedAt: Date.now(), version: 1 });
            const msgBuf = b4a.from(stableStringify(payload));
            let sig = this.peer.wallet.sign(msgBuf);
            let sigHex = typeof sig === 'string' ? sig : (sig?.length > 0 ? b4a.toString(sig, 'hex') : '');
            const welcome = { payload, sig: sigHex };
            try { this.peer.sidechannel.acceptInvite(String(channel), null, welcome); } catch (_e) {}
            console.log(JSON.stringify(welcome));
            console.log('welcome_b64:', b4a.toString(b4a.from(JSON.stringify(welcome)), 'base64'));
            return;
        }
        if (this.input.startsWith("/sc_stats")) {
            if (!this.peer.sidechannel) { console.log('Sidechannel not initialized.'); return; }
            console.log({ channels: Array.from(this.peer.sidechannel.channels.keys()), connectionCount: this.peer.sidechannel.connections.size });
            return;
        }
        if (this.input.startsWith("/print")) {
            const splitted = this.parseArgs(input);
            console.log(splitted.text);
        }
    }
}

export default SampleProtocol;