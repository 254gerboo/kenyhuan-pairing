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
const path = require('path')
const express = require('express')

const sessionName = './session'
const usePairingCode = true
const useMobile = false
const PORT = Number(process.env.PORT) || 3000

const logger = pino({ level: 'silent' })
const msgRetryCounterCache = new NodeCache()
const app = express()
let sock = null

const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(chalk.cyan(`Server listening on http://localhost:${port}`))
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1
      console.log(chalk.yellow(`Port ${port} is busy. Retrying on http://localhost:${nextPort}`))
      startServer(nextPort)
      return
    }

    throw err
  })
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const question = (text) =>
  new Promise((resolve) => rl.question(text, resolve))

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pairing.html'))
})

app.get('/pairing', (_req, res) => {
  res.sendFile(path.join(__dirname, 'pairing.html'))
})

app.post('/requestPairingCode', async (req, res) => {
  const phoneNumber = (req.body.phoneNumber || '').toString().replace(/\D/g, '')

  if (!phoneNumber) {
    return res.status(400).send('<h3>Phone number is required.</h3>')
  }

  if (!sock || !sock.authState) {
    return res.status(503).send('<h3>WhatsApp socket is not ready yet.</h3>')
  }

  try {
    const code = await sock.requestPairingCode(phoneNumber)
    res.type('html').send(`
      <html>
        <body style="font-family: sans-serif; padding: 30px;">
          <h2>Pairing code generated</h2>
          <p><strong>${code}</strong></p>
          <p>Use this code in your WhatsApp app to complete pairing.</p>
          <a href="/">Request another code</a>
        </body>
      </html>
    `)
  } catch (err) {
    console.error(chalk.red('Pairing request failed:'), err)
    res.status(500).send('<h3>Failed to generate pairing code. Please try again.</h3>')
  }
})

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionName)
  const { version, isLatest } = await fetchLatestBaileysVersion()

  console.log(
    chalk.green(`Using WA v${version.join('.')}, latest: ${isLatest}`)
  )

  sock = makeWASocket({
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

  if (usePairingCode && !sock.authState.creds.registered) {
    if (useMobile) {
      throw new Error('Pairing code is not supported with mobile API')
    }

    const isInteractiveTerminal = process.stdin.isTTY && !process.env.PORT
    if (isInteractiveTerminal) {
      const phoneNumber = await question(
        'Enter WhatsApp number (country code included, no +): '
      )

      const code = await sock.requestPairingCode(phoneNumber)
      console.log(chalk.yellow('Pairing code:'), code)
    }
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

startServer(PORT)

startBot().catch(err => {
  console.error('Fatal error:', err)
})
