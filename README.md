# Platoon Website

Static marketing site plus the public password reset and account deletion bridges for Platoon.

The repo is intentionally a small static site, not a Next.js app. The marketing homepage is built from plain HTML and shared CSS so the existing public utility routes keep working as static directory routes with no framework migration risk.

## Marketing Site Structure

- `index.html` contains the public marketing homepage for Platoon.
- `styles.css` contains the shared visual system, marketing sections, mock product components, and utility-page styles.
- `assets/images/platoon-logo.png` and `assets/images/favicon.png` are reused across the homepage and utility pages.

The homepage positions Platoon as mobile-first software for firefighter unions and union leadership. It includes:
- A clean white product-led hero.
- Member and union leadership value sections.
- Editable HTML/CSS product mockups using fake data only:
  - mobile calendar view
  - mobile union home / feature hub
  - admin dashboard overview
- A feature grid covering calendars, events, announcements, messaging, email, SMS, polls, official voting, recommendations, documents, audience groups, and shift trading.
- The existing Formspree early-access form action.

## Public Routes

The site currently exposes these public static routes:
- `/`
- `/reset-password/`
- `/support/`
- `/privacy/`
- `/delete-account/`

Route preservation note:
- `/reset-password/` is preserved as the password reset bridge.
- `/delete-account/` is preserved as the self-service account deletion bridge.
- `/support/` is preserved for public support.
- `/privacy/` is preserved for the public privacy policy.

## Password Reset Bridge

The site exposes a dedicated recovery completion page at `/reset-password/`.

Why this exists:
- Supabase password reset emails should redirect users back to an application surface that can finish recovery.
- Email-to-mobile deep link recovery has been unreliable, so the web page is the primary reset completion surface.
- The page validates the recovery link, restores or verifies the Supabase recovery session, prompts for a new password, and then calls `supabase.auth.updateUser({ password })`.

## Account Deletion Bridge

The site exposes a dedicated self-service deletion flow at `/delete-account/`.

How the flow works:
- The user enters their account email.
- The page sends a one-time Supabase email verification link back to `/delete-account`.
- The page validates the returned link, restores the verified session, and asks for an explicit permanent-delete confirmation.
- The page calls a backend deletion endpoint that should delete or anonymize account-owned data and then remove the auth user.
- The page shows a final success state when deletion completes.

## Required Configuration

Before deploying the reset and delete pages, ensure these public meta tag values are set correctly:
- `platoon-supabase-url`
- `platoon-supabase-anon-key`

For the delete flow, also set:
- `platoon-delete-account-endpoint`

These are public client values except for the delete endpoint, which should point to your secured backend handler.

In Supabase Auth URL configuration:
- Set the email reset redirect target to `https://your-domain.com/reset-password`
- Add `https://your-domain.com/reset-password` and `https://your-domain.com/reset-password/` to Redirect URLs
- Add `https://your-domain.com/delete-account` and `https://your-domain.com/delete-account/` to Redirect URLs for the deletion verification link

When sending a reset email from the app, use:

```ts
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: "https://your-domain.com/reset-password"
});
```

The delete page itself sends the verification email with:

```ts
await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: "https://your-domain.com/delete-account",
    shouldCreateUser: false
  }
});
```

## Delete Endpoint Contract

The page expects `POST platoon-delete-account-endpoint` to:
- Authenticate the caller from the bearer access token created by the deletion verification link.
- Delete or anonymize account-owned rows in application tables.
- Preserve shared trade history needed by other users in anonymized form.
- Delete the Supabase auth user when cleanup finishes.
- Return a JSON success response with HTTP 200 on completion.

## Deployment Notes

No web server changes are required for the static routes. On Vercel, each route works as a static directory route because the page lives in a matching folder such as `reset-password/index.html`, `support/index.html`, `privacy/index.html`, or `delete-account/index.html`.

The deletion flow does require a deployed backend endpoint before it can complete successfully in production.

## Local Verification

Because the site is static, you can serve it locally from PowerShell with:

```powershell
python -m http.server 4173
```

Then verify:
- `http://localhost:4173/`
- `http://localhost:4173/reset-password/`
- `http://localhost:4173/delete-account/`
- `http://localhost:4173/support/`
- `http://localhost:4173/privacy/`
