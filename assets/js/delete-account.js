import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const EMAIL_TIMEOUT_MS = 12000;
const DELETE_TIMEOUT_MS = 20000;
const REQUEST_STATE_KEY = "platoon-delete-account-email";
const DELETE_REDIRECT_PATH = "/delete-account";

const stateElements = {
  request: document.getElementById("delete-request-state"),
  emailSent: document.getElementById("delete-email-sent-state"),
  validating: document.getElementById("delete-validating-state"),
  confirm: document.getElementById("delete-confirm-state"),
  success: document.getElementById("delete-success-state"),
  error: document.getElementById("delete-error-state")
};

const statusPill = document.getElementById("delete-status-pill");
const requestForm = document.getElementById("delete-request-form");
const requestStatus = document.getElementById("delete-request-status");
const requestButton = document.getElementById("delete-request-button");
const confirmForm = document.getElementById("delete-confirm-form");
const confirmStatus = document.getElementById("delete-confirm-status");
const confirmButton = document.getElementById("delete-confirm-button");
const confirmEmail = document.getElementById("delete-confirm-email");
const emailSentValue = document.getElementById("delete-email-sent-value");
const errorMessage = document.getElementById("delete-error-message");
const restartButton = document.getElementById("restart-delete-button");
const editEmailButton = document.getElementById("edit-email-button");

const config = getConfig();
let isDeleteReady = false;
let sessionRestorePromise = null;

console.info("[delete-account] page init", {
  deleteUrlPresent: Boolean(config && config.deleteEndpoint),
  supabaseUrlPresent: Boolean(config && config.url)
});

if (!config) {
  console.error("[delete-account] missing config", {
    hasSupabaseUrl: Boolean(getMetaContent("platoon-supabase-url")),
    hasAnonKey: Boolean(getMetaContent("platoon-supabase-anon-key")),
    hasDeleteEndpoint: Boolean(getMetaContent("platoon-delete-account-endpoint"))
  });
  showError(
    "Account deletion is not configured on this site yet. Add the Supabase project URL, publishable anon key, and delete endpoint before using this page."
  );
} else {
  initializeDeleteFlow().catch(function (error) {
    console.error("[delete-account] init failed", error);
    showError(formatLinkError(error));
  });
}

async function initializeDeleteFlow() {
  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });

  setDeleteReady(false);

  requestForm.addEventListener("submit", function (event) {
    event.preventDefault();
    void handleVerificationRequest(supabase);
  });

  confirmForm.addEventListener("submit", function (event) {
    event.preventDefault();
    console.info("[delete-account] confirm form submit prevented");
  });

  confirmButton.addEventListener("click", function (event) {
    event.preventDefault();
    void handleDeletionConfirmation(supabase);
  });

  restartButton.addEventListener("click", function (event) {
    event.preventDefault();
    resetToRequestState();
  });

  editEmailButton.addEventListener("click", function (event) {
    event.preventDefault();
    resetToRequestState();
  });

  restoreRequestedEmail();

  const tokens = extractAuthTokens(window.location.href);
  console.info("[delete-account] token inspection", {
    hasAnyToken: tokens.hasAnyToken,
    hasAccessToken: Boolean(tokens.accessToken),
    hasRefreshToken: Boolean(tokens.refreshToken),
    hasCode: Boolean(tokens.code),
    hasTokenHash: Boolean(tokens.tokenHash),
    hasToken: Boolean(tokens.token)
  });

  if (!tokens.hasAnyToken) {
    setStatus("neutral", "Request verification");
    showState("request");
    console.info("[delete-account] no verification tokens found; staying on request state");
    return;
  }

  setStatus("pending", "Validating link");
  showState("validating");

  sessionRestorePromise = restoreDeletionSession(supabase, tokens);
  await sessionRestorePromise;
}

async function restoreDeletionSession(supabase, tokens) {
  console.info("[delete-account] token/session restore start");

  try {
    await withTimeout(initializeSupabaseSession(supabase, tokens), EMAIL_TIMEOUT_MS);

    const sessionResult = await supabase.auth.getSession();
    console.info("[delete-account] token/session restore getSession result", {
      hasSession: Boolean(sessionResult && sessionResult.data && sessionResult.data.session),
      hasAccessToken: Boolean(
        sessionResult &&
        sessionResult.data &&
        sessionResult.data.session &&
        sessionResult.data.session.access_token
      ),
      error: sessionResult.error ? sessionResult.error.message : null
    });

    if (sessionResult.error || !sessionResult.data.session) {
      throw sessionResult.error || new Error("missing_delete_session");
    }

    const userEmail = sessionResult.data.session.user && sessionResult.data.session.user.email
      ? sessionResult.data.session.user.email
      : getStoredEmail();

    if (!userEmail) {
      throw new Error("missing_delete_email");
    }

    storeEmail(userEmail);
    confirmEmail.textContent = userEmail;
    clearSensitiveUrl();
    showState("confirm");
    setStatus("neutral", "Ready to confirm");
    setDeleteReady(true);
    console.info("[delete-account] token/session restore success", {
      email: userEmail,
      hasSession: true,
      hasAccessToken: true,
      deleteUrlPresent: Boolean(config.deleteEndpoint)
    });
  } catch (error) {
    setDeleteReady(false);
    console.error("[delete-account] token/session restore failure", error);
    throw error;
  }
}

async function handleVerificationRequest(supabase) {
  const emailInput = requestForm.elements.email;
  const email = (emailInput.value || "").trim().toLowerCase();

  if (!email || !isValidEmail(email)) {
    setFormStatus(requestStatus, "Enter the email address for the Platoon account you want to delete.", "error");
    return;
  }

  try {
    requestButton.disabled = true;
    setStatus("pending", "Sending link");
    setFormStatus(requestStatus, "Sending a secure verification link...", "pending");

    const result = await withTimeout(
      supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getDeleteRedirectUrl(),
          shouldCreateUser: false
        }
      }),
      EMAIL_TIMEOUT_MS
    );

    if (result.error) {
      throw result.error;
    }

    storeEmail(email);
    emailSentValue.textContent = email;
    setFormStatus(requestStatus, "", "");
    showState("emailSent");
    setStatus("success", "Email sent");
  } catch (error) {
    console.error("[delete-account] verification email request failed", error);
    setStatus("neutral", "Request verification");
    setFormStatus(requestStatus, formatRequestError(error), "error");
  } finally {
    requestButton.disabled = false;
  }
}

async function handleDeletionConfirmation(supabase) {
  console.info("[delete-account] delete confirmation click", {
    isDeleteReady,
    hasSessionRestorePromise: Boolean(sessionRestorePromise),
    deleteUrlPresent: Boolean(config && config.deleteEndpoint)
  });

  if (sessionRestorePromise) {
    console.info("[delete-account] awaiting session restoration before delete");

    try {
      await sessionRestorePromise;
    } catch (error) {
      console.error("[delete-account] session restoration unavailable during delete", error);
      setFormStatus(confirmStatus, formatLinkError(error), "error");
      return;
    }
  }

  if (!isDeleteReady) {
    console.warn("[delete-account] delete blocked because session is not ready");
    setFormStatus(confirmStatus, "Please reopen the verification link and try again.", "error");
    return;
  }

  const acknowledged = confirmForm.elements.acknowledged.checked;

  if (!acknowledged) {
    setFormStatus(confirmStatus, "Confirm that you understand this deletion is permanent before continuing.", "error");
    return;
  }

  try {
    confirmButton.disabled = true;
    setStatus("pending", "Deleting account");
    setFormStatus(confirmStatus, "Deleting your account...", "pending");

    const sessionResult = await supabase.auth.getSession();
    const session = sessionResult.data ? sessionResult.data.session : null;
    const accessToken = session ? session.access_token : "";

    console.info("[delete-account] session check before delete POST", {
      hasSession: Boolean(session),
      hasAccessToken: Boolean(accessToken),
      deleteUrlPresent: Boolean(config.deleteEndpoint),
      error: sessionResult.error ? sessionResult.error.message : null
    });

    if (sessionResult.error || !session) {
      const missingSessionError = new Error("missing_delete_session");
      missingSessionError.code = "missing_session";
      throw missingSessionError;
    }

    if (!accessToken) {
      const missingTokenError = new Error("missing_delete_access_token");
      missingTokenError.code = "missing_access_token";
      throw missingTokenError;
    }

    console.info("[delete-account] about to send delete POST", {
      url: config.deleteEndpoint,
      email: getStoredEmail(),
      hasAccessToken: true
    });

    const deletionResponse = await withTimeout(
      fetch(config.deleteEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + accessToken,
          apikey: config.anonKey
        },
        body: JSON.stringify({
          email: getStoredEmail()
        }),
        keepalive: false
      }),
      DELETE_TIMEOUT_MS
    );

    console.info("[delete-account] delete POST fetch returned", {
      status: deletionResponse.status,
      ok: deletionResponse.ok,
      redirected: deletionResponse.redirected,
      type: deletionResponse.type
    });

    const responseBody = await readResponseBody(deletionResponse);
    if (!deletionResponse.ok) {
      console.error("[delete-account] delete POST non-2xx response", {
        status: deletionResponse.status,
        bodyText: responseBody.text,
        bodyJson: responseBody.json
      });

      const apiError = new Error(getApiErrorMessage(responseBody.json, responseBody.text));
      apiError.code = "delete_non_2xx";
      apiError.status = deletionResponse.status;
      apiError.responseBody = responseBody;
      throw apiError;
    }

    console.info("[delete-account] delete POST succeeded", {
      status: deletionResponse.status,
      bodyText: responseBody.text,
      bodyJson: responseBody.json
    });

    await supabase.auth.signOut();
    window.sessionStorage.removeItem(REQUEST_STATE_KEY);
    setFormStatus(confirmStatus, "", "");
    showState("success");
    setStatus("success", "Account deleted");
  } catch (error) {
    console.error("[delete-account] delete confirmation catch", {
      code: error && error.code ? error.code : null,
      status: error && error.status ? error.status : null,
      message: error && error.message ? error.message : String(error),
      responseBody: error && error.responseBody ? error.responseBody : null,
      error: error
    });
    setStatus("neutral", "Ready to confirm");
    setFormStatus(confirmStatus, formatDeleteError(error), "error");
  } finally {
    if (isDeleteReady) {
      confirmButton.disabled = false;
    }
  }
}

async function initializeSupabaseSession(supabase, tokens) {
  if (tokens.accessToken && tokens.refreshToken) {
    console.info("[delete-account] restoring session via access + refresh token");
    const sessionResult = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken
    });

    if (sessionResult.error) {
      throw sessionResult.error;
    }

    return;
  }

  if (tokens.code) {
    console.info("[delete-account] restoring session via auth code exchange");
    const exchangeResult = await supabase.auth.exchangeCodeForSession(tokens.code);
    if (exchangeResult.error) {
      throw exchangeResult.error;
    }

    return;
  }

  if (tokens.tokenHash) {
    console.info("[delete-account] restoring session via token hash verifyOtp");
    const verifyResult = await supabase.auth.verifyOtp({
      token_hash: tokens.tokenHash,
      type: tokens.type
    });

    if (verifyResult.error) {
      throw verifyResult.error;
    }

    return;
  }

  if (tokens.token) {
    console.info("[delete-account] restoring session via token verifyOtp");
    const verifyOptions = {
      token: tokens.token,
      type: tokens.type
    };

    if (tokens.email) {
      verifyOptions.email = tokens.email;
    }

    const verifyResult = await supabase.auth.verifyOtp(verifyOptions);
    if (verifyResult.error) {
      throw verifyResult.error;
    }

    return;
  }

  throw new Error("missing_delete_token");
}

function getConfig() {
  const url = getMetaContent("platoon-supabase-url");
  const anonKey = getMetaContent("platoon-supabase-anon-key");
  const deleteEndpoint = getMetaContent("platoon-delete-account-endpoint");

  if (
    !url ||
    !anonKey ||
    !deleteEndpoint ||
    url.indexOf("REPLACE_WITH_") === 0 ||
    anonKey.indexOf("REPLACE_WITH_") === 0 ||
    deleteEndpoint.indexOf("REPLACE_WITH_") === 0
  ) {
    return null;
  }

  return { url, anonKey, deleteEndpoint };
}

function getMetaContent(name) {
  const element = document.querySelector('meta[name="' + name + '"]');
  return element ? element.content.trim() : "";
}

function getDeleteRedirectUrl() {
  return window.location.origin + DELETE_REDIRECT_PATH;
}

function extractAuthTokens(urlString) {
  const url = new URL(urlString);
  const searchParams = new URLSearchParams(url.search);
  const hashParams = parseHashParams(url.hash);

  return {
    accessToken: firstDefined(searchParams.get("access_token"), hashParams.get("access_token")),
    refreshToken: firstDefined(searchParams.get("refresh_token"), hashParams.get("refresh_token")),
    tokenHash: firstDefined(searchParams.get("token_hash"), hashParams.get("token_hash")),
    token: firstDefined(searchParams.get("token"), hashParams.get("token")),
    code: firstDefined(searchParams.get("code"), hashParams.get("code")),
    email: firstDefined(searchParams.get("email"), hashParams.get("email")),
    type: normalizeOtpType(firstDefined(searchParams.get("type"), hashParams.get("type"))),
    hasAnyToken: Boolean(
      firstDefined(
        searchParams.get("access_token"),
        hashParams.get("access_token"),
        searchParams.get("token_hash"),
        hashParams.get("token_hash"),
        searchParams.get("token"),
        hashParams.get("token"),
        searchParams.get("code"),
        hashParams.get("code")
      )
    )
  };
}

function parseHashParams(hash) {
  const normalizedHash = hash.replace(/^#\/?/, "").replace(/^\?/, "");
  return new URLSearchParams(normalizedHash);
}

function normalizeOtpType(type) {
  const allowedTypes = ["magiclink", "email", "signup", "invite"];
  return allowedTypes.indexOf(type) === -1 ? "magiclink" : type;
}

function firstDefined() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    if (value) {
      return value;
    }
  }

  return "";
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      window.setTimeout(function () {
        reject(new Error("timeout"));
      }, timeoutMs);
    })
  ]);
}

function showState(activeState) {
  Object.keys(stateElements).forEach(function (key) {
    stateElements[key].hidden = key !== activeState;
  });
}

function setStatus(tone, text) {
  statusPill.dataset.tone = tone;
  statusPill.textContent = text;
}

function setDeleteReady(ready) {
  isDeleteReady = ready;
  confirmButton.disabled = !ready;
}

function setFormStatus(element, message, state) {
  element.textContent = message;

  if (state) {
    element.dataset.state = state;
  } else {
    delete element.dataset.state;
  }
}

function showError(message) {
  errorMessage.textContent = message;
  showState("error");
  setStatus("error", "Link unavailable");
}

function clearSensitiveUrl() {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
}

function restoreRequestedEmail() {
  const storedEmail = getStoredEmail();
  if (storedEmail) {
    requestForm.elements.email.value = storedEmail;
    emailSentValue.textContent = storedEmail;
  }
}

function resetToRequestState() {
  clearSensitiveUrl();
  sessionRestorePromise = null;
  setDeleteReady(false);
  confirmForm.reset();
  setFormStatus(requestStatus, "", "");
  setFormStatus(confirmStatus, "", "");
  showState("request");
  setStatus("neutral", "Request verification");
}

function storeEmail(email) {
  window.sessionStorage.setItem(REQUEST_STATE_KEY, email);
}

function getStoredEmail() {
  return window.sessionStorage.getItem(REQUEST_STATE_KEY) || "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readResponseBody(response) {
  const text = await response.text();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }

  return { text, json };
}

function getApiErrorMessage(responseJson, responseText) {
  if (responseJson && typeof responseJson.error === "string" && responseJson.error) {
    return responseJson.error;
  }

  if (responseJson && typeof responseJson.message === "string" && responseJson.message) {
    return responseJson.message;
  }

  if (responseText) {
    return responseText;
  }

  return "The server could not complete account deletion.";
}

function formatRequestError(error) {
  const message = error && error.message ? error.message.toLowerCase() : "";

  if (message.indexOf("timeout") !== -1) {
    return "Sending the verification email timed out. Try again.";
  }

  if (message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1) {
    return "A network error interrupted the request. Check your connection and try again.";
  }

  if (message.indexOf("email") !== -1 || message.indexOf("otp") !== -1) {
    return "We could not send the verification link. Confirm the email address and try again.";
  }

  return error && error.message
    ? error.message
    : "We could not start account deletion right now. Try again shortly.";
}

function formatLinkError(error) {
  const message = error && error.message ? error.message.toLowerCase() : "";

  if (message.indexOf("timeout") !== -1) {
    return "We could not validate this deletion link in time. Reload the page or request a new verification email.";
  }

  if (message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1) {
    return "A network error interrupted account verification. Check your connection and try the link again.";
  }

  if (
    message.indexOf("expired") !== -1 ||
    message.indexOf("invalid") !== -1 ||
    message.indexOf("otp") !== -1 ||
    message.indexOf("token") !== -1
  ) {
    return "This account deletion link is invalid or has expired. Request a new verification email and try again.";
  }

  if (message.indexOf("missing_delete_session") !== -1 || message.indexOf("missing_delete_email") !== -1) {
    return "This deletion link is missing required verification details. Request a new email and try again.";
  }

  return "We could not start account deletion from this link. Request a new verification email and try again.";
}

function formatDeleteError(error) {
  const message = error && error.message ? error.message.toLowerCase() : "";

  if (
    message.indexOf("missing_delete_session") !== -1 ||
    message.indexOf("missing_delete_access_token") !== -1
  ) {
    return "Your verification session expired. Reopen the deletion link and try again.";
  }

  if (message.indexOf("timeout") !== -1) {
    return "Account deletion timed out. Try again.";
  }

  if (message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1) {
    return "A network error interrupted account deletion. Check your connection and try again.";
  }

  if (message.indexOf("not configured") !== -1 || message.indexOf("404") !== -1) {
    return "The deletion service is not available yet. Deploy the delete endpoint and try again.";
  }

  return error && error.message
    ? error.message
    : "We could not complete account deletion. Try again or contact support if this keeps happening.";
}
