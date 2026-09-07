import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const binary = fileURLToPath(new URL(process.platform === 'win32' ? '../bin/excaligo.exe' : '../bin/excaligo', import.meta.url))
const logPrefix = '[run 启动桌面应用][app=excaligo]'
const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' })
child.on('error', error => { console.error(logPrefix, error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
