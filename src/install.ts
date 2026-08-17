import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import process from 'node:process'
import { x } from 'tinyexec'
import { detectPackageManager } from './detect'

export interface InstallPackageOptions {
  cwd?: string
  dev?: boolean
  silent?: boolean
  packageManager?: string
  preferOffline?: boolean
  additionalArgs?: string[] | ((agent: string, detectedAgent: string) => string[] | undefined)
}
/**
 * Find the root directory of the pnpm workspace upward
 */
function findPnpmWorkspaceRoot(startDir: string): string | null {
  let currentDir = resolve(startDir)

  while (true) {
    if (existsSync(resolve(currentDir, 'pnpm-workspace.yaml'))) {
      return currentDir
    }
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

export async function installPackage(names: string | string[], options: InstallPackageOptions = {}) {
  const detectedAgent = options.packageManager || await detectPackageManager(options.cwd) || 'npm'
  const [agent] = detectedAgent.split('@')

  if (!Array.isArray(names))
    names = [names]

  const args = (typeof options.additionalArgs === 'function'
    ? options.additionalArgs(agent, detectedAgent)
    : options.additionalArgs) || []

  if (options.preferOffline) {
    // yarn berry uses --cached option instead of --prefer-offline
    if (detectedAgent === 'yarn@berry')
      args.unshift('--cached')
    else
      args.unshift('--prefer-offline')
  }

  // 用于最终执行命令的 cwd，默认为 options.cwd
  let commandCwd = options.cwd ?? process.cwd()

  if (agent === 'pnpm') {
    args.unshift(
      /**
       * Prevent pnpm from removing installed devDeps while `NODE_ENV` is `production`
       * @see https://pnpm.io/cli/install#--prod--p
       */
      '--prod=false',
    )

    const targetDir = options.cwd ?? process.cwd()
    const workspaceRoot = findPnpmWorkspaceRoot(targetDir)
    
    if (workspaceRoot !== targetDir) {
      // In the monorepo, attempt to obtain the names of the sub-projects
      const pkgPath = resolve(targetDir, 'package.json')
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
          if (pkg.name) {
            // Use --filter to precisely specify subprojects
            args.unshift('--filter', pkg.name)
          } else {
            // demotion
            args.unshift('-w')
          }
        } catch {
          //demotion
          args.unshift('-w')
        }
      } else {
        // demotion
        args.unshift('-w')
      }
      commandCwd = workspaceRoot
    } else if (existsSync(resolve(targetDir, 'pnpm-workspace.yaml'))) {
      args.unshift('-w')
    }
  }

  return x(
    agent,
    [
      agent === 'yarn'
        ? 'add'
        : 'install',
      options.dev ? '-D' : '',
      ...args,
      ...names,
    ].filter(Boolean),
    {
      nodeOptions: {
        stdio: options.silent ? 'ignore' : 'inherit',
        cwd: commandCwd, // Use the calculated directory
      },
      throwOnError: true,
    },
  )
}