const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  delay
} = require('@whiskeysockets/baileys')

const pino = require('pino')
const NodeCache = require('node-cache')
const readline = require('readline')
const chalk = require('chalk')
const fs = require('fs')

const sessionName = './session'
const usePairingCode = true
const useMobile = false

const logger = pino({ level: 'silent' })
const msgRetryCounterCache = new NodeCache()

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const question = (text) =>
  new Promise((resolve) => rl.question(text, resolve))

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionName)
  const { version, isLatest } = await fetchLatestBaileysVersion()

  console.log(
    chalk.green(`Using WA v${version.join('.')}, latest: ${isLatest}`)
  )

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !usePairingCode,
    mobile: useMobile,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    msgRetryCounterCache
  })

  // pairing code
  if (usePairingCode && !sock.authState.creds.registered) {
    if (useMobile) {
      throw new Error('Pairing code is not supported with mobile API')
    }

    const phoneNumber = await question(
      'Enter WhatsApp number (country code included, no +): '
    )

    const code = await sock.requestPairingCode(phoneNumber)
    console.log(chalk.yellow('Pairing code:'), code)
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      console.log(chalk.green('✅ WhatsApp connected'))
    }

    if (connection === 'close') {
      const reason =
        lastDisconnect?.error?.output?.statusCode

      if (reason === DisconnectReason.loggedOut) {
        console.log(chalk.red('❌ Logged out. Delete session and re-pair.'))
        process.exit(0)
      } else {
        console.log(chalk.yellow('Reconnecting...'))
        await delay(2000)
        startBot()
      }
    }
  })

  sock.ev.on('creds.update', saveCreds)
}

startBot().catch(err => {
  console.error('Fatal error:', err)
})
