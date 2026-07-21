import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service — Oppulence",
  description: "The terms that govern your use of Oppulence.",
};

const LAST_UPDATED = "July 21, 2026";

const SECTIONS: LegalSection[] = [
  {
    heading: "Agreement to these terms",
    body: [
      "These Terms of Service (the “Terms”) govern your access to and use of Oppulence, including the web console, desktop application, APIs, and related services (collectively, the “Service”). By creating an account or using the Service, you agree to these Terms. If you are using the Service on behalf of an organization, you represent that you are authorized to bind that organization, and “you” refers to that organization.",
    ],
  },
  {
    heading: "The Service",
    body: [
      "Oppulence is a revenue memory and execution system. It helps you remember commercial relationships, identify who needs attention and why, verify what is safe to send, and prepare next actions for your review. Oppulence prepares recommendations and drafts; you remain responsible for the actions you approve and send.",
      "We may update, add, or remove features over time. We may also impose limits on certain features or restrict access to parts of the Service without notice or liability.",
    ],
  },
  {
    heading: "Accounts and eligibility",
    body: [
      "You sign in through a supported identity provider (for example, Google). You are responsible for maintaining the security of your account and for all activity that occurs under it. You must provide accurate information and promptly update it as needed.",
      "You must be at least 18 years old, or the age of majority in your jurisdiction, and able to form a binding contract to use the Service.",
    ],
  },
  {
    heading: "Acceptable use",
    body: [
      "You agree not to:",
      [
        "Use the Service to violate any law, regulation, or third-party right, including sending communications that are unlawful, deceptive, harassing, or unsolicited in violation of anti-spam laws.",
        "Attempt to gain unauthorized access to the Service, other accounts, or connected systems, or interfere with or disrupt the integrity or performance of the Service.",
        "Reverse engineer, resell, or use the Service to build a competing product, except to the extent this restriction is prohibited by applicable law.",
        "Upload malware, or use the Service to process data you do not have the right to process.",
      ],
    ],
  },
  {
    heading: "Connected accounts and third-party services",
    body: [
      "The Service can connect to third-party accounts and providers that you authorize, such as email, calendar, and business tools. Your use of those services is governed by their own terms and privacy policies. You are responsible for the accounts you connect and for ensuring you have the right to grant Oppulence access to the associated data.",
      "You can disconnect a connected account at any time from the Service. We access connected data only to provide the features you use, as described in our Privacy Policy.",
    ],
  },
  {
    heading: "AI-generated content and human review",
    body: [
      "The Service uses automated systems, including large language models, to generate summaries, classifications, drafts, and suggested actions. This output may be inaccurate, incomplete, or not suitable for your purpose. You are responsible for reviewing any content or action before you rely on it, send it, or otherwise act on it. Oppulence prepares actions for your approval and does not send external communications on your behalf without a step you control.",
    ],
  },
  {
    heading: "Your data and ownership",
    body: [
      "As between you and Oppulence, you retain all rights to the data you provide or that Oppulence processes on your behalf (“Your Data”). You grant Oppulence a limited license to host, process, and transmit Your Data solely to provide and improve the Service and as directed by you. We handle Your Data in accordance with our Privacy Policy.",
    ],
  },
  {
    heading: "Fees and billing",
    body: [
      "Paid plans, if any, are billed through our payment processor on the terms presented at purchase. Unless stated otherwise, fees are non-refundable, and you authorize recurring charges until you cancel. We may change pricing prospectively with reasonable notice.",
    ],
  },
  {
    heading: "Intellectual property",
    body: [
      "The Service, including its software, design, and content (excluding Your Data), is owned by Oppulence and its licensors and is protected by intellectual-property laws. Except for the rights expressly granted to you, we reserve all rights in the Service.",
    ],
  },
  {
    heading: "Disclaimers",
    body: [
      "The Service is provided “as is” and “as available,” without warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, secure, or error-free, or that any output will be accurate or reliable.",
    ],
  },
  {
    heading: "Limitation of liability",
    body: [
      "To the maximum extent permitted by law, Oppulence will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, revenue, data, or goodwill. Our aggregate liability arising out of or relating to the Service will not exceed the amounts you paid to us for the Service in the twelve months before the event giving rise to the claim, or one hundred U.S. dollars if you have not paid us.",
    ],
  },
  {
    heading: "Termination",
    body: [
      "You may stop using the Service at any time. We may suspend or terminate your access if you breach these Terms, if required by law, or to protect the Service or other users. Upon termination, your right to use the Service ends; sections that by their nature should survive will survive.",
    ],
  },
  {
    heading: "Changes to these terms",
    body: [
      "We may update these Terms from time to time. If we make material changes, we will take reasonable steps to notify you, such as by posting the updated Terms with a new “Last updated” date. Your continued use of the Service after changes take effect constitutes acceptance of the updated Terms.",
    ],
  },
  {
    heading: "Governing law",
    body: [
      "These Terms are governed by the laws of the jurisdiction in which Oppulence is established, without regard to its conflict-of-laws principles. The courts located there will have exclusive jurisdiction over disputes arising out of or relating to these Terms, unless applicable law requires otherwise.",
    ],
  },
  {
    heading: "Contact",
    body: ["Questions about these Terms can be sent to legal@oppulence.io."],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      intro="These Terms explain the rules for using Oppulence. Please read them carefully — by using the Service you agree to them."
      lastUpdated={LAST_UPDATED}
      otherDoc={{ label: "Privacy Policy", href: "/privacy" }}
      sections={SECTIONS}
      title="Terms of Service"
    />
  );
}
