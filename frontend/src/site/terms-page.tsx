import { Link } from "react-router"

import { LegalLayout } from "./components/legal-layout"
import type { LegalSection } from "./components/legal-layout"
import { GITHUB_URL } from "./config"

const SECTIONS: LegalSection[] = [
  {
    title: "The software",
    body: (
      <p>
        DockWell is open source software released under the MIT licence. You may use, copy, modify and distribute it under the terms of that
        licence, which you can read in the <a href={`${GITHUB_URL}/blob/main/LICENSE`} target="_blank" rel="noopener">repository</a>. The
        software is provided "as is", without warranty of any kind.
      </p>
    ),
  },
  {
    title: "Using a DockWell install",
    body: (
      <ul>
        <li>Each install is operated independently. Its operator sets prices, limits and acceptable use, and is responsible for the models it serves.</li>
        <li>Keep your API keys secret. You are responsible for all usage made with your keys and workspaces.</li>
        <li>Do not use the service to break the law, attack other systems, or generate content that violates the model licences or the operator's rules.</li>
        <li>Operators may suspend accounts or workspaces that break these terms.</li>
      </ul>
    ),
  },
  {
    title: "Credits and payments",
    body: (
      <ul>
        <li>Credits are prepaid, in US dollars, and are used at the model prices shown at the time of each request. Price changes never affect past requests.</li>
        <li>Credits are added only after the payment processor (Stripe) confirms the payment.</li>
        <li>Failed requests are not charged. A request you cancel mid-stream is charged for the tokens generated until then.</li>
        <li>Refunds are at the operator's discretion. A refund removes the matching credit from the workspace.</li>
        <li>Starter credit, when offered, is granted once per account and has no cash value.</li>
      </ul>
    ),
  },
  {
    title: "The public demo",
    body: (
      <p>
        The demo is provided for evaluation only. It uses Stripe test mode, so no real payments are taken, and accounts and data may be deleted
        at any time. There is no availability guarantee. <Link to="/docs/self-hosting">Self-host DockWell</Link> for production use.
      </p>
    ),
  },
  {
    title: "Liability",
    body: (
      <p>
        To the extent permitted by law, the DockWell authors are not liable for any damages arising from the use of the software or any install
        of it. Model outputs can be wrong; review them before relying on them.
      </p>
    ),
  },
  {
    title: "Changes",
    body: <p>These terms may change. Material changes are noted in the repository changelog. Continuing to use an install means you accept the current terms.</p>,
  },
]

export function TermsPage() {
  return (
    <LegalLayout
      eyebrow="Terms"
      title="Terms of service"
      intro="The rules for using DockWell software and the installs that run it."
      updated="16 October 2026"
      sections={SECTIONS}
    />
  )
}
