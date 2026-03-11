import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const RECOVERY_TIMEOUT_MS = 12000;
const MIN_PASSWORD_LENGTH = 8;

const stateElements = {
  loading: document.getElementById("loading-state"),
  ready: document.getElementById("ready-state"),
  success: document.getElementById("success-state"),
  error: document.getElementById("error-state")
};

const statusPill = document.getElementById("status-pill");
const errorMessage = document.getElementById("error-message");
const form = document.getElementById("reset-form");
const formStatus = document.getElementById("form-status");
const submitButton = document.getElementById("submit-button");

const config = getSupabaseConfig();

if (!config) {
  showError(
    "Password reset is not configured on this site yet. Add the Supabase project URL and publishable anon key before using this page."
  );
} else {
  initializeRecovery().catch(function (error) {
    showError(formatRecoveryError(error));
  });
}

async function initializeRecovery() {
  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    handlePasswordSubmit(supabase);
  });

  const tokens = extractRecoveryTokens(window.location.href);

  if (!tokens.hasAnyToken) {
    throw new Error("missing_recovery_token");
  }

  setStatus("pending", "Validating link");

  await withTimeout(initializeSupabaseRecovery(supabase, tokens), RECOVERY_TIMEOUT_MS);

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error || !sessionResult.data.session) {
    throw sessionResult.error || new Error("missing_recovery_session");
  }

  clearSensitiveUrl();
  showState("ready");
  setStatus("neutral", "Ready");
}

async function initializeSupabaseRecovery(supabase, tokens) {
  if (tokens.accessToken && tokens.refreshToken) {
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
    const exchangeResult = await supabase.auth.exchangeCodeForSession(tokens.code);
    if (exchangeResult.error) {
      throw exchangeResult.error;
    }

    return;
  }

  if (tokens.tokenHash) {
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

  throw new Error("missing_recovery_token");
}

async function handlePasswordSubmit(supabase) {
  const newPasswordInput = form.elements.newPassword;
  const confirmPasswordInput = form.elements.confirmPassword;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!newPassword || !confirmPassword) {
    setFormStatus("Both password fields are required.", "error");
    return;
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    setFormStatus("Use a password with at least 8 characters.", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    setFormStatus("Passwords do not match.", "error");
    return;
  }

  try {
    submitButton.disabled = true;
    setStatus("pending", "Updating password");
    setFormStatus("Updating your password...", "pending");

    const result = await withTimeout(
      supabase.auth.updateUser({ password: newPassword }),
      RECOVERY_TIMEOUT_MS
    );

    if (result.error) {
      throw result.error;
    }

    setFormStatus("", "");
    showState("success");
    setStatus("success", "Password updated");
    form.reset();
  } catch (error) {
    setStatus("neutral", "Ready");
    setFormStatus(formatUpdateError(error), "error");
  } finally {
    submitButton.disabled = false;
  }
}

function getSupabaseConfig() {
  const url = getMetaContent("platoon-supabase-url");
  const anonKey = getMetaContent("platoon-supabase-anon-key");

  if (!url || !anonKey || url.indexOf("REPLACE_WITH_") === 0 || anonKey.indexOf("REPLACE_WITH_") === 0) {
    return null;
  }

  return { url, anonKey };
}

function getMetaContent(name) {
  const element = document.querySelector('meta[name="' + name + '"]');
  return element ? element.content.trim() : "";
}

function extractRecoveryTokens(urlString) {
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
    type: normalizeRecoveryType(firstDefined(searchParams.get("type"), hashParams.get("type"))),
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

function normalizeRecoveryType(type) {
  return type === "recovery" ? "recovery" : "recovery";
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

function clearSensitiveUrl() {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
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

function setFormStatus(message, state) {
  formStatus.textContent = message;

  if (state) {
    formStatus.dataset.state = state;
  } else {
    delete formStatus.dataset.state;
  }
}

function showError(message) {
  errorMessage.textContent = message;
  showState("error");
  setStatus("error", "Link unavailable");
}

function formatRecoveryError(error) {
  const message = error && error.message ? error.message.toLowerCase() : "";

  if (message.indexOf("timeout") !== -1) {
    return "We could not validate this reset link in time. Reload the page or request a new password reset email.";
  }

  if (message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1) {
    return "A network error interrupted password recovery. Check your connection and try the reset link again.";
  }

  if (message.indexOf("expired") !== -1 || message.indexOf("invalid") !== -1 || message.indexOf("otp") !== -1) {
    return "This password reset link is invalid or has expired. Request a new reset email and try again.";
  }

  if (message.indexOf("missing_recovery_token") !== -1 || message.indexOf("missing_recovery_session") !== -1) {
    return "This password reset link is missing required recovery information. Request a new reset email and try again.";
  }

  return "We could not start password recovery from this link. Request a new reset email and try again.";
}

function formatUpdateError(error) {
  const message = error && error.message ? error.message.toLowerCase() : "";

  if (message.indexOf("timeout") !== -1) {
    return "Password update timed out. Try again.";
  }

  if (message.indexOf("fetch") !== -1 || message.indexOf("network") !== -1) {
    return "Network error. Check your connection and try again.";
  }

  return error && error.message
    ? error.message
    : "Password update failed. Request a new reset email if this keeps happening.";
}
