'use strict'

/**
 * PollNet Feature
 *
 * Wires up the PollNet contract + protocol to the Intercom peer node.
 * Registers /tx command handlers and sets up the timer for poll auto-close.
 */

import PollNetContract from '../../contract/contract.js'
import PollNetProtocol from '../../contract/protocol.js'

const TICK_INTERVAL_MS = 15_000 // Check for expired polls every 15 seconds

class PollNetFeature {
  constructor ({ peer, sidechannel }) {
    this.peer = peer
    this.contract = new PollNetContract()
    this.protocol = new PollNetProtocol({
      contract: this.contract,
      sidechannel
    })
    this._ticker = null
  }

  /**
   * Called by Intercom when the node starts.
   */
  async start () {
    // Load persisted state if available
    const saved = await this.peer.storage.get('pollnet:state')
    if (saved) {
      try {
        this.contract.load(JSON.parse(saved))
      } catch (_) {
        // Corrupt state — start fresh
      }
    }

    // Register the /tx command handler
    this.peer.onCommand('poll_create', (cmd, peer) => this._handle(cmd, peer))
    this.peer.onCommand('poll_vote', (cmd, peer) => this._handle(cmd, peer))
    this.peer.onCommand('poll_results', (cmd, peer) => this._handle(cmd, peer))
    this.peer.onCommand('poll_list', (cmd, peer) => this._handle(cmd, peer))

    // Start the auto-close ticker
    this._ticker = setInterval(() => this._tick(), TICK_INTERVAL_MS)

    console.log('[PollNet] started — join sidechannel "pollnet" to watch events')
  }

  /**
   * Called by Intercom when the node shuts down.
   */
  async stop () {
    if (this._ticker) clearInterval(this._ticker)
    await this._saveState()
    console.log('[PollNet] stopped')
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  async _handle (command, peer) {
    const result = await this.protocol.handle(command, peer)
    await this._saveState()
    return result
  }

  async _tick () {
    await this.protocol.tick()
    await this._saveState()
  }

  async _saveState () {
    try {
      await this.peer.storage.set('pollnet:state', JSON.stringify(this.contract.dump()))
    } catch (err) {
      console.error('[PollNet] state save error:', err.message)
    }
  }
}

export default PollNetFeature