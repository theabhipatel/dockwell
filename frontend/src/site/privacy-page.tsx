import { Link } from "react-router"

import { LegalLayout } from "./components/legal-layout"
import type { LegalSection } from "./components/legal-layout"
import { GITHUB_URL } from "./config"

const SECTIONS: LegalSection[] = [
  {
    title: "Who this applies to",
    body: (
      <p>
        DockWell is open source software that anyone can run. This policy describes what the software stores. Each install is run by its own
        operator, who is responsible for how they use it. On the public demo, the operator is the DockWell project. On a self-hosted install,
        it is whoever runs that server.
      </p>
    ),
  },
  {
    title: "What is stored",
    body: (
      <ul>
        <li>Your account: name, email address, an Argon2id hash of your password (or your Google account id), optional profile picture, theme and notification preferences.</li>
        <li>Security records: active sessions with IP address and browser, sign-in history and the activity log of your workspaces.</li>
        <li>Workspace data: workspaces, members, roles, projects, API key names and a SHA-256 hash of each key (never the key itself).</li>
        <li>Usage: for every request, the time, model, token counts, cost, latency, status and the project, key and member it belongs to.</li>
        <li>Billing: credit balance, the credit ledger, payment records and billing details you enter. Card details are held by Stripe, never by DockWell.</li>
        <li>Saved playground conversations, visible only to you, until you delete them.</li>
      </ul>
    ),
  },
  {
    title: "Prompts and responses",
    body: (
      <p>
        By default DockWell does <strong>not</strong> store the content of your prompts or the model's responses, only the numbers needed for
        billing and logs. An operator can turn content logging on for their install, and every workspace can still opt out in its settings.
        Requests are sent to the model provider configured by the operator (for example a vLLM server on the same machine, or Groq on the demo),
        which has its own policy.
      </p>
    ),
  },
  {
    title: "How long data is kept",
    body: (
      <ul>
        <li>Request logs are deleted after the retention period set by the operator (30 days by default) or a shorter one chosen by the workspace.</li>
        <li>Daily usage totals, the credit ledger and payment records are kept for accounting.</li>
        <li>The activity log is append-only and kept for security.</li>
        <li>Deleting your account removes your profile, sessions and solo workspaces. Records others need (ledger entries, logs) keep only references.</li>
      </ul>
    ),
  },
  {
    title: "Emails and cookies",
    body: (
      <p>
        DockWell sends transactional emails (verification, password reset, security alerts, invitations, billing and usage alerts). You can turn
        off non-security emails in your notification settings. It uses only first-party cookies needed to keep you signed in and to protect
        forms against cross-site requests. There are no analytics or advertising trackers.
      </p>
    ),
  },
  {
    title: "The public demo",
    body: (
      <p>
        Anyone can sign up to the demo, payments run in Stripe test mode and data may be reset at any time. Do not send confidential data to the
        demo. For real use, <Link to="/docs/self-hosting">run DockWell on your own server</Link>.
      </p>
    ),
  },
  {
    title: "Questions",
    body: (
      <p>
        For a self-hosted install, contact its operator. For the project itself, open an issue on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>. Please do not post personal data there.
      </p>
    ),
  },
]

export function PrivacyPage() {
  return (
    <LegalLayout
      eyebrow="Privacy"
      title="Privacy policy"
      intro="Plain and short: what DockWell stores, what it does not, and how long it keeps it."
      updated="16 October 2026"
      sections={SECTIONS}
    />
  )
}
