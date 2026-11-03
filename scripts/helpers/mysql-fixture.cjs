const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const mysql = require('mysql2/promise')

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function run(command, args, ms = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.on('data', (data) => { errors = (errors + data).slice(-4000) })
    const timer = setTimeout(() => child.kill('SIGKILL'), ms)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${command} failed (${signal || code}): ${errors}`))
    })
  })
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function createMysqlFixture() {
  const database = `kindra_smoke_${crypto.randomBytes(8).toString('hex')}`
  const external = process.env.KINDRAAPI_SMOKE_MYSQL_HOST
  let dir, child, admin, created = false, closed = false
  let config
  const close = async () => {
    if (closed) return
    closed = true
    let failure
    try {
      if (created) {
        const connection = admin || await mysql.createConnection({ ...config, database: undefined, connectTimeout: 5000 })
        try { await connection.query(`DROP DATABASE IF EXISTS \`${database}\``) } finally { await connection.end(); admin = undefined }
      } else if (admin) { await admin.end(); admin = undefined }
    } catch (error) { failure = error }
    if (child) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGTERM')
        await Promise.race([exited, timeout(10000)])
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
      }
    }
    if (dir) await fs.rm(dir, { recursive: true, force: true })
    if (failure) throw failure
  }
  try {
    if (external) {
      config = { host: external, port: Number(process.env.KINDRAAPI_SMOKE_MYSQL_PORT || 3307), user: process.env.KINDRAAPI_SMOKE_MYSQL_USER || 'root', password: process.env.KINDRAAPI_SMOKE_MYSQL_PASSWORD || '', database }
    } else {
      const mysqld = process.env.KINDRAAPI_TEST_MYSQLD || 'mysqld'
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindra-mysql-fixture-'))
      const datadir = path.join(dir, 'data')
      await fs.mkdir(datadir)
      await run(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${datadir}`])
      const port = await freePort()
      const socket = path.join(dir, 'mysql.sock')
      config = { host: '127.0.0.1', port, user: 'root', password: '', database }
      child = spawn(mysqld, ['--no-defaults', `--datadir=${datadir}`, `--socket=${socket}`, `--pid-file=${path.join(dir, 'mysql.pid')}`, `--port=${port}`, '--bind-address=127.0.0.1', '--mysqlx=0'], { stdio: ['ignore', 'ignore', 'pipe'] })
      let errors = '', spawnError
      child.stderr.on('data', (data) => { errors = (errors + data).slice(-4000) })
      child.on('error', (error) => { spawnError = error })
      const deadline = Date.now() + 30000
      while (!admin && Date.now() < deadline) {
        if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`Private mysqld failed: ${spawnError || errors}`)
        try { admin = await mysql.createConnection({ ...config, database: undefined, connectTimeout: 1000 }) } catch { await timeout(200) }
      }
      if (!admin) throw new Error(`Private mysqld did not become ready: ${errors}`)
    }
    if (!admin) admin = await mysql.createConnection({ ...config, database: undefined, connectTimeout: 5000 })
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
    created = true
    await admin.query(`CREATE TABLE \`${database}\`.sample_table (database_field INT NOT NULL DEFAULT 7 COMMENT '数据库字段', optional_text VARCHAR(80) NULL COMMENT '可选文本')`)
    await admin.end()
    admin = undefined
    return { config, close }
  } catch (error) {
    try { await close() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'MySQL fixture setup and cleanup failed') }
    throw error
  }
}

module.exports = { createMysqlFixture }
