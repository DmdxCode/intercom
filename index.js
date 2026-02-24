'use strict'

/**
 * PollNet — Entry Point
 *
 * Bootstraps the Intercom peer with the PollNet feature.
 * Run with: pear run --tmp-store --no-pre . --peer-store-name admin ...
 */

const Intercom = require('intercom') // provided by Trac Network / Pear runtime
const PollNetFeature = require('./features/pollnet/index')

async function main () {
  const peer = new Intercom({
    // Pear runtime injects argv automatically
  })

  // Register PollNet as the application layer
  peer.use(new PollNetFeature({
    peer,
    sidechannel: peer.sidechannel
  }))

  await peer.start()

  console.log('')
  console.log('╔══════════════════════════════════════╗')
  console.log('║          PollNet is running!          ║')
  console.log('╠══════════════════════════════════════╣')
  console.log('║  Create a poll:                       ║')
  console.log('║  /tx --command \'{"op":"poll_create",  ║')
  console.log('║    "question":"Which?",               ║')
  console.log('║    "options":["A","B"],"duration":60}\'║')
  console.log('║                                       ║')
  console.log('║  Watch live: /sc_join --channel pollnet║')
  console.log('╚══════════════════════════════════════╝')
  console.log('')
}

main().catch(err => {
  console.error('[PollNet] fatal error:', err)
  process.exit(1)
})