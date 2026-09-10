// Runs the game server and the Vite dev server together, so `npm run dev`
// is a single command. No extra dependency needed for this.
import { spawn } from 'node:child_process'

const children = []

function run(label, command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
  const tag = (line) => `[${label}] ${line}`
  const pipe = (stream, to) => {
    stream.setEncoding('utf8')
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) to.write(tag(line) + '\n')
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    process.stdout.write(tag(`exited with code ${code}`) + '\n')
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

let shuttingDown = false
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 200)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('server', process.execPath, ['server/server.js'])
run('vite', process.execPath, ['node_modules/vite/bin/vite.js'])
