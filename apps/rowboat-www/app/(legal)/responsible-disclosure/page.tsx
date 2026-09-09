import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Responsible Disclosure Policy — Oppulence",
  description:
    "How to report a security vulnerability in Oppulence, and what we commit to in return.",
};

const EFFECTIVE = "September 8, 2026";
const LAST_UPDATED = "September 8, 2026";

const SECTIONS: LegalSection[] = [
  {
    heading: "Overview",
    body: [
      "Oppulence connects to some of the most sensitive systems a company has — email, calendars, meetings, messaging, and CRM. We take the security of the Service and of the data entrusted to it seriously.",
      "This Responsible Disclosure Policy explains how security researchers and users can report suspected vulnerabilities in a safe, coordinated, and constructive way. If you believe you have found a vulnerability, please report it promptly and give us a reasonable opportunity to investigate and remediate before disclosing details publicly.",
    ],
  },
  {
    heading: "Reporting a vulnerability",
    body: [
      "Email reports to security@oppulence.io. Include enough detail for us to reproduce and understand the issue:",
      [
        "A clear description of the vulnerability and its potential impact.",
        "The affected product, endpoint, domain, connector, or repository.",
        "Steps to reproduce, along with proof-of-concept code, screenshots, or logs where safe to share.",
        "Any accounts, workspaces, or test data you used during your research.",
        "How you would like us to contact you for follow-up, and whether you want credit.",
      ],
      "Do not include sensitive personal data, secrets, access tokens, or customer content unless it is strictly necessary to demonstrate the issue. If you must, redact aggressively and tell us what you redacted.",
    ],
  },
  {
    heading: "Scope",
    body: [
      "This policy covers vulnerabilities affecting Oppulence-operated services, including:",
      [
        "The Oppulence website, web console, and desktop application.",
        "Oppulence APIs and hosted infrastructure.",
        "Official Oppulence connectors and integrations, including the OAuth flows and credential custody used to reach connected systems.",
        "Authentication, authorization, workspace isolation, and tenant data-separation controls.",
        "Handling of model prompts and outputs where a flaw leads to unauthorized data access, such as cross-tenant leakage through an AI feature.",
        "Public repositories owned by Oppulence, where the issue affects Oppulence users or infrastructure.",
      ],
      "Third-party services, platforms, and dependencies are in scope only where the vulnerability results from our implementation or configuration. Report issues in a third party's own product to that third party.",
    ],
  },
  {
    heading: "Research guidelines",
    body: [
      "When conducting research, you agree to:",
      [
        "Test only with accounts, workspaces, connected sources, and data that you own or are explicitly authorized to test.",
        "Avoid accessing, modifying, deleting, or exfiltrating data that does not belong to you, including any customer content reachable through a connector.",
        "Stop immediately and notify us if you encounter non-public user data, credentials, secrets, or internal systems, and delete any such data once it is reported.",
        "Avoid service degradation, denial-of-service testing, spam, social engineering, phishing, and physical attacks.",
        "Use the smallest proof of concept that demonstrates the issue, rather than maximizing extracted data.",
        "Comply with applicable law and with this policy.",
      ],
    ],
  },
  {
    heading: "Out of scope",
    body: [
      "The following are generally out of scope unless you can demonstrate a concrete, exploitable security impact:",
      [
        "Automated scanner output without validation or a practical attack path.",
        "Missing security headers or cookie flags that do not enable a meaningful exploit.",
        "Clickjacking on pages without sensitive actions.",
        "Rate limiting, brute force, or account enumeration reports without material impact.",
        "Self-XSS, logout CSRF, and issues requiring unlikely user interaction.",
        "Model output that is merely inaccurate, biased, or undesirable, absent a security impact such as unauthorized data access.",
        "Publicly disclosed vulnerabilities in third-party software without evidence that Oppulence is affected.",
        "Denial-of-service, load testing, spam, phishing, social engineering, or physical security testing.",
      ],
    ],
  },
  {
    heading: "Our commitments",
    body: [
      "When you follow this policy, we will make a good-faith effort to:",
      [
        "Acknowledge receipt of your report within 3 business days.",
        "Provide an initial assessment, including whether the issue is in scope and our preliminary severity rating, within 10 business days.",
        "Validate, prioritize, and remediate confirmed vulnerabilities according to severity and risk.",
        "Keep you informed of meaningful status changes, and let you know when a fix ships.",
        "Credit you for responsible disclosure if you request recognition and disclosure is appropriate.",
      ],
    ],
  },
  {
    heading: "Confidentiality and coordinated disclosure",
    body: [
      "Please keep vulnerability details confidential until we have investigated and addressed the issue. We aim to remediate high-severity issues within 90 days and will coordinate timing with you.",
      "Public disclosure should be coordinated with us and must not include user data, secrets, or exploit code that enables active abuse, or any information that would materially increase risk to users.",
      "If we cannot fix an issue within a reasonable time, we will explain why and agree a disclosure timeline with you rather than leaving the report open indefinitely.",
    ],
  },
  {
    heading: "Rewards",
    body: [
      "Oppulence does not currently operate a public bug bounty program and does not guarantee monetary rewards. We may, at our discretion, provide recognition, swag, or a reward for high-quality reports of significant issues.",
    ],
  },
  {
    heading: "Safe harbor",
    body: [
      "We will not initiate or support legal action against security research conducted in good faith, in accordance with this policy, and without harm to Oppulence, our users, or third parties. We will consider such research authorized under the Computer Fraud and Abuse Act and equivalent laws, and we will not pursue claims under anti-circumvention laws for good-faith research.",
      "If a third party brings legal action against you for research conducted in compliance with this policy, we will make it known that your activity was authorized.",
      "This safe harbor does not apply to activity that violates the law, causes service disruption, accesses or discloses data without authorization, or otherwise exceeds the scope and guidelines set out above.",
    ],
  },
  {
    heading: "Contact",
    body: [
      "Send vulnerability reports to security@oppulence.io. For privacy matters see privacy@oppulence.io, and for legal notices see legal@oppulence.io.",
      "Playbook Media, Inc. · Oppulence",
    ],
  },
];

export default function ResponsibleDisclosurePage() {
  return (
    <LegalDocument
      contactEmail="security@oppulence.io"
      effective={EFFECTIVE}
      intro="How to report a security vulnerability in Oppulence, what is in scope, and what we commit to in return. Report first, disclose after we have had a fair chance to fix it."
      lastUpdated={LAST_UPDATED}
      related={[
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
      ]}
      sections={SECTIONS}
      title="Responsible Disclosure Policy"
    />
  );
}
