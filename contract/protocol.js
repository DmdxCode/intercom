'use strict'

/**
 * PollNet Protocol
 *
 * Routes incoming /tx commands to the PollNet contract and handles
 * sidechannel broadcast of poll events to the 'pollnet' channel.
 */

const POLLNET_CHANNEL = 'pollnet'

class PollNetProtocol {
  constructor ({ contract, sidechannel }) {
    this.contract = contract
    this.sidechannel = sidechannel
  }

  /**
   * Handle an incoming /tx command from a peer.
   * @param {object} command  - Parsed JSON command from the peer
   * @param {string} peer     - Public key of the sending peer
   * @returns {object}        - { ok, result?, error? }
   */
  async handle (command, peer) {
    const response = this.contract.apply(command, peer)

    // Broadcast poll events to the sidechannel so observers can watch live
    if (response.ok && response.broadcast) {
      await this._broadcast(response.broadcast)
    }

    // Return only the public-facing fields
    return {
      ok: response.ok,
      ...(response.result ? { result: response.result } : {}),
      ...(response.error ? { error: response.error } : {})
    }
  }

  /**
   * Called periodically by the timer feature to close expired polls
   * and broadcast their final results.
   */
  async tick () {
    const events = this.contract.tick()
    for (const event of events) {
      await this._broadcast(event)
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _broadcast (payload) {
    if (!this.sidechannel) return
    try {
      const message = JSON.stringify(payload)
      await this.sidechannel.broadcast(POLLNET_CHANNEL, message)
    } catch (err) {
      // Non-fatal — sidechannel may not be connected yet
      console.error('[PollNet] broadcast error:', err.message)
    }
  }
}

module.exports = PollNetProtocol