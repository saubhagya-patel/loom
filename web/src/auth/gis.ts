const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'

type CodeResponse = { code?: string; error?: string }
type CodeClient = { requestCode: () => void }

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient: (config: {
            client_id: string
            scope: string
            ux_mode: 'popup' | 'redirect'
            callback: (response: CodeResponse) => void
          }) => CodeClient
        }
      }
    }
  }
}

// One in-flight load, shared. Appending the script twice would register a second copy of
// Google's globals.
let loading: Promise<void> | null = null

function loadGis(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null // let a later attempt retry rather than caching the failure forever
      reject(new Error('could not load google identity services'))
    }
    document.head.appendChild(script)
  })
  return loading
}

// Popup mode, so no redirect URI is registered on the OAuth client at all: in popup mode
// `redirect_uri` is ignored and defaults to the page's origin (agent-cache/knowledge.md).
// The authorized JavaScript origin is the only console setting this needs.
export async function requestAuthCode(clientId: string): Promise<string> {
  await loadGis()
  const oauth2 = window.google?.accounts.oauth2
  if (!oauth2) throw new Error('google identity services did not initialise')

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPE,
      ux_mode: 'popup',
      callback: (response) => {
        if (response.code) resolve(response.code)
        // A closed popup calls back with an error rather than never calling back, so this
        // promise always settles.
        else reject(new Error(response.error ?? 'sign-in was cancelled'))
      },
    })
    client.requestCode()
  })
}
