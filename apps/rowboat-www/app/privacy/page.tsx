import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy — Oppulence",
  description: "How Oppulence collects, uses, and protects your information.",
};

const LAST_UPDATED = "July 21, 2026";

const SECTIONS: LegalSection[] = [
  {
    heading: "Overview",
    body: [
      "This Privacy Policy explains how Oppulence collects, uses, and shares information when you use the web console, desktop application, APIs, and related services (the “Service”). Oppulence is designed around user-owned context, explicit connections, and keeping you in control of what is sent. We collect only what we need to provide the Service.",
    ],
  },
  {
    heading: "Information we collect",
    body: [
      "Account information: when you sign in through an identity provider such as Google, we receive basic profile details like your name, email address, and a provider account identifier.",
      "Connected-service data: when you authorize a connection (for example, email or calendar), we access the data needed to provide the features you use — such as messages, contacts, and events — as scoped by the permissions you grant.",
      "Content you create: notes, rules, drafts, and other content you add to the Service.",
      "Usage and device data: logs, feature usage, and technical information such as IP address and browser or app version, used to operate and secure the Service.",
    ],
  },
  {
    heading: "How we use information",
    body: [
      "We use information to:",
      [
        "Provide, maintain, and improve the Service, including remembering relationships, identifying who needs attention, and preparing draft actions for your review.",
        "Authenticate you and secure your account and connected data.",
        "Provide support and communicate with you about the Service.",
        "Detect, prevent, and address fraud, abuse, and security issues, and comply with legal obligations.",
      ],
    ],
  },
  {
    heading: "AI processing",
    body: [
      "To power features such as summaries, classifications, and drafts, relevant content may be processed by automated systems, including large language models, that operate on your behalf. We apply privacy safeguards such as minimizing the data sent for a given task and redacting sensitive values where feasible. Model outputs are prepared for your review; Oppulence does not send external communications without a step you control.",
    ],
  },
  {
    heading: "Google user data",
    body: [
      "Oppulence’s use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. We use Google user data only to provide and improve user-facing features of the Service, do not sell it, and do not use it for advertising. We do not transfer it except as necessary to provide those features, to comply with applicable law, or as part of a merger or acquisition with appropriate safeguards. You can revoke Oppulence’s access to your Google account at any time through your Google account settings or by disconnecting the account in the Service.",
    ],
  },
  {
    heading: "How we share information",
    body: [
      "We do not sell your personal information. We share information only in these limited circumstances:",
      [
        "Service providers and subprocessors who host infrastructure, process payments, or provide model inference on our behalf, under contractual confidentiality and security obligations.",
        "Providers you connect, to deliver the features you request.",
        "Legal and safety reasons, when required by law or to protect rights, safety, and the integrity of the Service.",
        "Business transfers, in connection with a merger, acquisition, or sale of assets, subject to this Policy.",
      ],
    ],
  },
  {
    heading: "Data retention",
    body: [
      "We retain information for as long as your account is active or as needed to provide the Service, and thereafter as required to comply with legal obligations, resolve disputes, and enforce agreements. You can delete content within the Service, and you can request deletion of your account data as described below.",
    ],
  },
  {
    heading: "Security",
    body: [
      "We use technical and organizational measures designed to protect information, including encryption in transit, encryption of sensitive stored credentials, and access controls. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    heading: "Your rights and choices",
    body: [
      "Depending on your location, you may have rights to access, correct, export, or delete your personal information, and to object to or restrict certain processing. You can exercise many of these controls directly in the Service — including disconnecting providers and deleting content — or by contacting us. We will respond consistent with applicable law.",
    ],
  },
  {
    heading: "International data transfers",
    body: [
      "We may process and store information in countries other than where you are located. Where required, we use appropriate safeguards for cross-border transfers of personal information.",
    ],
  },
  {
    heading: "Children",
    body: [
      "The Service is not directed to children under 16, and we do not knowingly collect personal information from them. If you believe a child has provided us information, please contact us and we will take appropriate steps to delete it.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: [
      "We may update this Privacy Policy from time to time. If we make material changes, we will take reasonable steps to notify you, such as by posting the updated Policy with a new “Last updated” date. Your continued use of the Service after changes take effect constitutes acceptance of the updated Policy.",
    ],
  },
  {
    heading: "Contact",
    body: ["Questions or requests about privacy can be sent to privacy@oppulence.io."],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      intro="Your data stays yours. This Policy describes what we collect, how we use it, and the controls you have."
      lastUpdated={LAST_UPDATED}
      otherDoc={{ label: "Terms of Service", href: "/terms" }}
      sections={SECTIONS}
      title="Privacy Policy"
    />
  );
}
