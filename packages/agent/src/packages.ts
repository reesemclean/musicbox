/**
 * Package Management
 * Ensure required packages are installed via apt.
 */

import { execSync } from 'child_process'

/**
 * Check if a package is installed
 */
function isPackageInstalled(pkg: string): boolean {
  try {
    execSync(`dpkg -s ${pkg} 2>/dev/null | grep -q "Status: install ok"`, {
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Ensure all required packages are installed
 * Returns true if any packages were installed
 */
export async function ensurePackages(packages: string[]): Promise<boolean> {
  const missing: string[] = []

  for (const pkg of packages) {
    if (!isPackageInstalled(pkg)) {
      missing.push(pkg)
    }
  }

  if (missing.length === 0) {
    return false
  }

  console.log(`Installing packages: ${missing.join(', ')}`)
  execSync(`apt-get update && apt-get install -y ${missing.join(' ')}`, {
    stdio: 'inherit',
  })

  return true
}
