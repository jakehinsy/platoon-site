# Platoon Website

Static marketing site and password reset bridge for Platoon.

## Public Routes

The site currently exposes these public static routes:
- `/`
- `/reset-password/`
- `/support/`

## Password Reset Bridge

The site exposes a dedicated recovery completion page at `/reset-password/`.

Why this exists:
- Supabase password reset emails should redirect users back to an application surface that can finish recovery.
- Email-to-mobile deep link recovery has been unreliable, so the web page is the primary reset completion surface.
- The page validates the recovery link, restores or verifies the Supabase recovery session, prompts for a new password, and then calls `supabase.auth.updateUser({ password })`.

## Required Configuration

Before deploying the reset page, replace the placeholder meta tags in [reset-password/index.html](/c:/dev/platoon-site/reset-password/index.html):
- `platoon-supabase-url`
- `platoon-supabase-anon-key`

These are public client values from Supabase project settings.

In Supabase Auth URL configuration:
- Set the email reset redirect target to `https://your-domain.com/reset-password`
- Add `https://your-domain.com/reset-password` and `https://your-domain.com/reset-password/` to Redirect URLs

When sending a reset email from the app, use:

```ts
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: "https://your-domain.com/reset-password"
});
```

## Deployment Notes

No server changes are required. On Vercel, each route works as a static directory route because the page lives in a matching folder such as `reset-password/index.html` or `support/index.html`.
