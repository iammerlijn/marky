// App tests in a real Tauri window (test plan, section 2): WebdriverIO with tauri-driver.
// Linux only: tauri-driver needs WebKitWebDriver (Ubuntu package webkitgtk-webdriver, Debian package webkit2gtk-driver).
// Build first: `npx tauri build --debug --no-bundle`. Run: `npx wdio run tests/e2e/wdio.conf.ts`
// (in CI with dbus-run-session and xvfb-run).
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fixture, original } from './fixture'

let driver: ChildProcess

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4444,
  specs: ['./app.e2e.ts'],
  maxInstances: 1,
  capabilities: [
    {
      // tauri-driver starts the app with these options.
      'tauri:options': { application: resolve('src-tauri/target/debug/marky'), args: [fixture] },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: 'warn',
  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 60000 },
  waitforTimeout: 15000,

  onPrepare: () => {
    mkdirSync(dirname(fixture), { recursive: true })
    writeFileSync(fixture, original)
  },
  beforeSession: () => {
    driver = spawn('tauri-driver', [], { stdio: [null, process.stdout, process.stderr] })
  },
  afterSession: () => {
    driver?.kill()
  },
}
