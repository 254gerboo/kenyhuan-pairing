const { proto, getContentType } = require('@whiskeysockets/baileys')
const chalk = require('chalk')
const fs = require('fs')
const Crypto = require('crypto')
const axios = require('axios')
const moment = require('moment-timezone')
const { sizeFormatter } = require('human-readable')
const util = require('util')
const Jimp = require('jimp')

/* ================= UTILITIES ================= */

const unixTimestampSeconds = (date = new Date()) =>
  Math.floor(date.getTime() / 1000)

exports.unixTimestampSeconds = unixTimestampSeconds

exports.generateMessageTag = (epoch) => {
  let tag = unixTimestampSeconds().toString()
  if (epoch) tag += '.--' + epoch
  return tag
}

exports.processTime = (timestamp, now) =>
  moment.duration(now - moment(timestamp * 1000)).asSeconds()

exports.getRandom = (ext) =>
  `${Math.floor(Math.random() * 10000)}${ext}`

exports.sleep = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms))

exports.isUrl = (url) =>
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}/gi.test(url)

exports.getTime = (format, date) =>
  date
    ? moment(date).locale('id').format(format)
    : moment.tz('Africa/Harare').locale('id').format(format)

exports.runtime = (seconds) => {
  seconds = Number(seconds)
  const d = Math.floor(seconds / (3600 * 24))
  const h = Math.floor(seconds % (3600 * 24) / 3600)
  const m = Math.floor(seconds % 3600 / 60)
  const s = Math.floor(seconds % 60)
  return [
    d && `${d} day`,
    h && `${h} hour`,
    m && `${m} minute`,
    s && `${s} second`
  ].filter(Boolean).join(', ')
}

exports.formatp = sizeFormatter({
  std: 'JEDEC',
  decimalPlaces: 2,
  keepTrailingZeroes: false,
  render: (literal, symbol) => `${literal} ${symbol}B`
})

exports.fetchJson = async (url, options = {}) => {
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...options
  })
  return res.data
}

exports.getBuffer = async (url, options = {}) => {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    ...options
  })
  return res.data
}

/* ================= SERIALIZER ================= */

/**
 * Serialize WhatsApp Message
 * store is OPTIONAL
 */
exports.smsg = (conn, m, store = null) => {
  if (!m) return m
  const M = proto.WebMessageInfo

  if (m.key) {
    m.id = m.key.id
    m.chat = m.key.remoteJid
    m.fromMe = m.key.fromMe
    m.isGroup = m.chat.endsWith('@g.us')
    m.sender = conn.decodeJid(
      m.fromMe
        ? conn.user.id
        : m.participant || m.key.participant || m.chat
    )
  }

  if (m.message) {
    m.mtype = getContentType(m.message)
    m.msg = m.message[m.mtype]
    m.text =
      m.msg?.text ||
      m.msg?.caption ||
      m.message.conversation ||
      ''

    const quoted = m.msg?.contextInfo?.quotedMessage
    if (quoted) {
      const type = getContentType(quoted)
      m.quoted = quoted[type]
      m.quoted.mtype = type
      m.quoted.id = m.msg.contextInfo.stanzaId
      m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat
      m.quoted.sender = conn.decodeJid(
        m.msg.contextInfo.participant
      )

      // SAFE quoted loader (only if store exists)
      m.getQuotedObj = async () => {
        if (!store || !m.quoted.id) return null
        const q = await store.loadMessage(m.chat, m.quoted.id)
        return exports.smsg(conn, q, store)
      }

      const vM = M.fromObject({
        key: {
          remoteJid: m.quoted.chat,
          fromMe: m.quoted.sender === conn.user.id,
          id: m.quoted.id
        },
        message: quoted,
        ...(m.isGroup ? { participant: m.quoted.sender } : {})
      })

      m.quoted.delete = () =>
        conn.sendMessage(m.quoted.chat, { delete: vM.key })

      m.quoted.copyNForward = (jid, force = false, opts = {}) =>
        conn.copyNForward(jid, vM, force, opts)

      m.quoted.download = () =>
        conn.downloadMediaMessage(m.quoted)
    }
  }

  m.reply = (text, chatId = m.chat, options = {}) =>
    conn.sendMessage(chatId, { text }, { quoted: m, ...options })

  return m
}

/* ================= HOT RELOAD ================= */

let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log(chalk.redBright(`Updated ${__filename}`))
  delete require.cache[file]
  require(file)
})
