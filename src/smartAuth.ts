/**
 * SMART on FHIR standalone-launch auth (browser, public client + PKCE).
 *
 * This is a self-contained implementation so you understand every step. In
 * production you may prefer the official `fhirclient` library — but this works
 * against Epic / Cerner / SMART Health IT sandboxes and has no dependencies.
 *
 * Flow:
 *   1. discover()        -> read .well-known/smart-configuration
 *   2. beginAuth()       -> create PKCE pair, redirect to authorize endpoint
 *   3. completeAuth()    -> on redirect back, exchange code for tokens
 *   4. refresh()         -> refresh the access token
 *
 * Tokens are kept in memory (never localStorage) per the spec's security NFR.
 */

export interface SmartConfig {
  iss: string;            // FHIR base URL (read server)
  clientId: string;
  redirectUri: string;
  scope: string;
  launch?: string;        // opaque token from EHR launch — omit for standalone
}

export interface SmartTokens {
  accessToken: string;
  refreshToken?: string;
  patient?: string;
  expiresAt: number;      // epoch ms
  tokenEndpoint: string;
  iss: string;            // FHIR base URL — where read calls go
}

interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
}

const STORE_KEY = "smart_pkce"; // sessionStorage holds ONLY the transient verifier + state during redirect

function base64UrlEncode(bytes: ArrayBuffer): string {
  const str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

function randomString(len = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return base64UrlEncode(bytes.buffer).slice(0, len);
}

export async function discover(iss: string): Promise<SmartConfiguration> {
  const url = `${iss.replace(/\/$/, "")}/.well-known/smart-configuration`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`SMART discovery failed: ${res.status}`);
  return res.json();
}

/** Step 2: redirect the browser to the authorize endpoint. */
export async function beginAuth(cfg: SmartConfig): Promise<void> {
  const conf = await discover(cfg.iss);
  const codeVerifier = randomString(64);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
  const state = randomString(32);

  sessionStorage.setItem(
    STORE_KEY,
    JSON.stringify({ codeVerifier, state, tokenEndpoint: conf.token_endpoint, cfg }),
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    state,
    aud: cfg.iss,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...(cfg.launch ? { launch: cfg.launch } : {}),
  });
  const authUrl = `${conf.authorization_endpoint}?${params.toString()}`;
  console.log("[SMART] Authorization URL:", authUrl);
  window.location.assign(authUrl);
}

/** Step 3: call on your redirect page; exchanges ?code for tokens. */
export async function completeAuth(): Promise<SmartTokens> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const raw = sessionStorage.getItem(STORE_KEY);
  if (!code || !raw) throw new Error("Missing auth code or PKCE state");

  const { codeVerifier, state, tokenEndpoint, cfg } = JSON.parse(raw) as {
    codeVerifier: string; state: string; tokenEndpoint: string; cfg: SmartConfig;
  };
  if (returnedState !== state) throw new Error("State mismatch — possible CSRF");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: codeVerifier,
  });
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  sessionStorage.removeItem(STORE_KEY);

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    patient: json.patient,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    tokenEndpoint,
    iss: cfg.iss,
  };
}

/** Step 4: refresh before expiry (Epic sandbox tokens last ~1h). */
export async function refresh(tokens: SmartTokens, clientId: string): Promise<SmartTokens> {
  if (!tokens.refreshToken) throw new Error("No refresh token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  const res = await fetch(tokens.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  const json = await res.json();
  return {
    ...tokens,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}