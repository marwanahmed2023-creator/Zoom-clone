function base64UrlBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlJson(value) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToBytes(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function firestoreClient(env) {
  if (!env.FIRESTORE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Firestore service account secret is missing.");
  }

  let account;
  try {
    account = JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("Firestore service account secret is not valid JSON.");
  }

  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error("Firestore service account JSON is missing required fields.");
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = base64UrlJson({ alg: "RS256", typ: "JWT" }) + "." +
    base64UrlJson({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    });

  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(unsigned)
  );
  const assertion = unsigned + "." + base64UrlBytes(new Uint8Array(signature));

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error("Google authentication failed: " + (tokenData.error_description || tokenData.error || tokenResponse.status));
  }

  const base = "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(account.project_id) + "/databases/(default)/documents";

  async function request(path, options = {}) {
    const url = path.startsWith("https://") ? path : base + path;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + tokenData.access_token,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Firestore request failed (" + response.status + "): " + detail.slice(0, 500));
    }
    if (response.status === 204) return null;
    return response.json();
  }

  return { base, request };
}
