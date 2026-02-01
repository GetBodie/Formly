#!/usr/bin/env npx ts-node
/**
 * One-time script to get a Dropbox refresh token
 *
 * Run: npx ts-node scripts/get-dropbox-refresh-token.ts
 */

import { Dropbox, DropboxAuth } from 'dropbox'
import * as readline from 'readline'

const APP_KEY = process.env.DROPBOX_APP_KEY || 'erqgy088w0ff5ni'
const APP_SECRET = process.env.DROPBOX_APP_SECRET || 'g9skhnfri79wjpg'

async function main() {
  const dbxAuth = new DropboxAuth({
    clientId: APP_KEY,
    clientSecret: APP_SECRET,
  })

  // Generate authorization URL
  const authUrl = await dbxAuth.getAuthenticationUrl(
    'http://localhost', // Redirect URI (not actually used for manual flow)
    undefined,
    'code',
    'offline', // This requests a refresh token!
    undefined,
    undefined,
    true // Use PKCE
  )

  console.log('\n=== Dropbox OAuth Setup ===\n')
  console.log('1. Open this URL in your browser:\n')
  console.log(authUrl)
  console.log('\n2. Authorize the app')
  console.log('3. Copy the authorization code from the redirect URL')
  console.log('   (It will be in the URL after "code=")\n')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const code = await new Promise<string>((resolve) => {
    rl.question('Paste the authorization code here: ', (answer) => {
      resolve(answer.trim())
      rl.close()
    })
  })

  if (!code) {
    console.error('No code provided')
    process.exit(1)
  }

  try {
    // Exchange code for tokens
    const codeVerifier = dbxAuth.getCodeVerifier()
    const response = await dbxAuth.getAccessTokenFromCode(
      'http://localhost',
      code
    )

    const result = response.result as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    console.log('\n=== Success! ===\n')
    console.log('Add these to your .env and Render environment:\n')
    console.log(`DROPBOX_ACCESS_TOKEN="${result.access_token}"`)
    console.log(`DROPBOX_REFRESH_TOKEN="${result.refresh_token}"`)
    console.log(`\nAccess token expires in ${result.expires_in} seconds`)
    console.log('Refresh token never expires (until revoked)')
  } catch (error) {
    console.error('Error exchanging code:', error)
    process.exit(1)
  }
}

main()
