'use strict'

/**
 * PollNet Contract
 *
 * Deterministic state machine for P2P polling on Intercom / Trac Network.
 * Stores polls, votes, and results. All state mutations go through apply().
 */

const MAX_QUESTION_LEN = 280
const MAX_OPTION_LEN = 100
const MAX_OPTIONS = 8
const MIN_OPTIONS = 2
const MAX_DURATION_MINUTES = 10080 // 1 week

class PollNetContract {
  constructor () {
    // Deterministic state
    this.state = {
      polls: {},
      next_poll_id: 1
    }
  }

  /**
   * Load existing state (called by Intercom on startup).
   */
  load (state) {
    if (state && typeof state === 'object') {
      this.state = state
    }
  }

  /**
   * Export current state (called by Intercom for persistence).
   */
  dump () {
    return this.state
  }

  /**
   * Apply a command to state. Must be pure / deterministic.
   * Returns { ok, result, error, broadcast }
   */
  apply (command, peer) {
    const { op } = command

    switch (op) {
      case 'poll_create':
        return this._pollCreate(command, peer)
      case 'poll_vote':
        return this._pollVote(command, peer)
      case 'poll_results':
        return this._pollResults(command)
      case 'poll_list':
        return this._pollList(command)
      default:
        return { ok: false, error: 'unknown_op' }
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  _pollCreate (cmd, peer) {
    const { question, options, duration_minutes } = cmd

    // Validate question
    if (!question || typeof question !== 'string') {
      return { ok: false, error: 'invalid_question' }
    }
    if (question.trim().length === 0 || question.length > MAX_QUESTION_LEN) {
      return { ok: false, error: `question must be 1–${MAX_QUESTION_LEN} chars` }
    }

    // Validate options
    if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      return { ok: false, error: `options must be an array of ${MIN_OPTIONS}–${MAX_OPTIONS} items` }
    }
    for (const opt of options) {
      if (typeof opt !== 'string' || opt.trim().length === 0 || opt.length > MAX_OPTION_LEN) {
        return { ok: false, error: `each option must be a non-empty string up to ${MAX_OPTION_LEN} chars` }
      }
    }

    // Validate duration
    let closes_at = null
    if (duration_minutes !== undefined) {
      const dur = Number(duration_minutes)
      if (!Number.isFinite(dur) || dur < 1 || dur > MAX_DURATION_MINUTES) {
        return { ok: false, error: `duration_minutes must be 1–${MAX_DURATION_MINUTES}` }
      }
      closes_at = Date.now() + dur * 60 * 1000
    }

    const id = this.state.next_poll_id++
    const poll = {
      id,
      question: question.trim(),
      options: options.map(o => o.trim()),
      votes: new Array(options.length).fill(0),
      voters: {},           // { [publicKey]: option_index }
      status: 'open',
      created_by: peer,
      created_at: Date.now(),
      closes_at
    }

    this.state.polls[id] = poll

    return {
      ok: true,
      result: { poll_id: id },
      broadcast: {
        event: 'POLL_CREATED',
        poll_id: id,
        question: poll.question,
        options: poll.options,
        closes_at: poll.closes_at
      }
    }
  }

  _pollVote (cmd, peer) {
    const { poll_id, option_index } = cmd

    const poll = this.state.polls[poll_id]
    if (!poll) {
      return { ok: false, error: 'poll_not_found' }
    }
    if (poll.status !== 'open') {
      return { ok: false, error: 'poll_closed' }
    }

    // Check if poll has expired (closes_at is stored but enforcement via timer)
    if (poll.closes_at && Date.now() > poll.closes_at) {
      poll.status = 'closed'
      return { ok: false, error: 'poll_closed' }
    }

    // One vote per peer
    if (poll.voters[peer] !== undefined) {
      return { ok: false, error: 'already_voted' }
    }

    const idx = Number(option_index)
    if (!Number.isFinite(idx) || idx < 0 || idx >= poll.options.length) {
      return { ok: false, error: `option_index must be 0–${poll.options.length - 1}` }
    }

    poll.voters[peer] = idx
    poll.votes[idx]++

    return {
      ok: true,
      result: { poll_id, option: poll.options[idx] },
      broadcast: {
        event: 'POLL_VOTE',
        poll_id,
        option: poll.options[idx],
        votes: [...poll.votes],
        total: poll.votes.reduce((s, v) => s + v, 0)
      }
    }
  }

  _pollResults (cmd) {
    const { poll_id } = cmd
    const poll = this.state.polls[poll_id]
    if (!poll) {
      return { ok: false, error: 'poll_not_found' }
    }
    return { ok: true, result: this._formatPoll(poll) }
  }

  _pollList (cmd) {
    const { include_closed } = cmd
    const polls = Object.values(this.state.polls)
      .filter(p => include_closed || p.status === 'open')
      .map(p => this._formatPoll(p))
    return { ok: true, result: { polls } }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _formatPoll (poll) {
    const total = poll.votes.reduce((s, v) => s + v, 0)
    let winner = null
    if (total > 0) {
      const maxVotes = Math.max(...poll.votes)
      const winnerIdx = poll.votes.indexOf(maxVotes)
      winner = poll.options[winnerIdx]
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
    }
  }

  /**
   * Called by the timer feature to close expired polls.
   * Returns array of broadcast events for closed polls.
   */
  tick () {
    const broadcasts = []
    const now = Date.now()
    for (const poll of Object.values(this.state.polls)) {
      if (poll.status === 'open' && poll.closes_at && now > poll.closes_at) {
        poll.status = 'closed'
        const result = this._formatPoll(poll)
        broadcasts.push({
          event: 'POLL_CLOSED',
          ...result
        })
      }
    }
    return broadcasts
  }
}

module.exports = PollNetContract