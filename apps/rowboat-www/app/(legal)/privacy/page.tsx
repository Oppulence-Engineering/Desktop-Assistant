import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy — Oppulence",
  description: "How Oppulence collects, uses, shares, and protects personal information.",
};

const EFFECTIVE = "September 8, 2026";
const LAST_UPDATED = "September 8, 2026";

const SECTIONS: LegalSection[] = [
  {
    heading: "Overview",
    body: [
      "Playbook Media, Inc. (“Oppulence,” “we,” “us,” or “our”) provides relationship intelligence software for customer-facing teams. This Privacy Policy describes how we process personal information collected through our website, web console, desktop application, APIs, connectors, and related services (collectively, the “Service”), as well as through our marketing activities.",
      "Oppulence is built around a simple principle: the data is yours, connections are explicit, and nothing leaves your control without a step you take. We collect what we need to run the Service, and not more.",
      "If you are located in the European Economic Area, the United Kingdom, or Switzerland (together, “Europe”), see the Notice to European users section below. If you are a resident of a U.S. state with a comprehensive privacy law, see the State privacy rights notice section.",
    ],
  },
  {
    heading: "Personal information we collect",
    summary: "Grouped by where it comes from.",
    body: [
      "Information you provide to us:",
      [
        {
          term: "Account data",
          text: "Your name, email address, profile image, organization name, and the account identifier supplied by your identity provider when you sign in (for example, Google).",
        },
        {
          term: "Workspace and configuration data",
          text: "Team and workspace names, member roles and invitations, notification preferences, connected-source settings, rules, and other configuration you create.",
        },
        {
          term: "User content",
          text: "Notes, prompts, drafts, comments, files, tasks, and other content you create or upload in the Service, together with associated metadata such as timestamps and authorship.",
        },
        {
          term: "Communications data",
          text: "Messages you send us for support, sales, or feedback, and our responses.",
        },
        {
          term: "Payment data",
          text: "Billing contact and plan details. Card numbers are collected and processed directly by our payment processor; we do not store full payment card numbers.",
        },
      ],
      "Information from sources you connect. When you authorize a connection, we access the data covered by the permissions you grant, which may include:",
      [
        {
          term: "Email and calendar data",
          text: "Message headers, bodies, attachments metadata, threads, participants, events, invitees, and availability from providers such as Google Workspace.",
        },
        {
          term: "Meeting data",
          text: "Meeting metadata and, where you enable it, recordings and transcripts of meetings you choose to capture.",
        },
        {
          term: "Messaging data",
          text: "Channel and direct-message content, participants, and metadata from platforms such as Slack, limited to the scopes you approve.",
        },
        {
          term: "CRM and business systems data",
          text: "Accounts, contacts, opportunities, activity history, and related records from systems such as HubSpot.",
        },
        {
          term: "Third-party personal information",
          text: "Because these sources describe your interactions with other people, they necessarily include personal information about your customers, prospects, and colleagues. You are responsible for having a lawful basis to share that information with us.",
        },
      ],
      "Information collected automatically:",
      [
        {
          term: "Device and technical data",
          text: "IP address, browser and operating system type and version, application version, device identifiers, language settings, and coarse location inferred from IP address.",
        },
        {
          term: "Usage data",
          text: "Pages and screens viewed, features used, actions taken, session duration, access times, referring pages, and error and diagnostic logs.",
        },
        {
          term: "Authentication and security data",
          text: "Sign-in events, session records, token issuance and refresh events, and audit logs of access to connected data.",
        },
      ],
    ],
  },
  {
    heading: "Cookies and similar technologies",
    body: [
      "We use strictly necessary cookies to keep you signed in, maintain your session, and protect against fraud and abuse. These cannot be disabled without breaking the Service.",
      "We also use first-party product analytics to understand how the Service is used and to improve it. We do not use advertising cookies, and we do not permit third-party advertising networks to track you across sites through the Service.",
      "Most browsers let you block or delete cookies through their settings. Blocking strictly necessary cookies will prevent you from signing in.",
    ],
  },
  {
    heading: "How we use personal information",
    body: [
      "We use personal information to:",
      [
        "Provide the Service: build and maintain the model of your relationships, detect what changed, prioritize what needs attention, assemble supporting evidence, and prepare drafts and suggested actions for your review.",
        "Create and administer accounts, workspaces, and permissions, and authenticate you.",
        "Process transactions, manage subscriptions, and send billing and service communications.",
        "Provide support, respond to your requests, and communicate about changes to the Service.",
        "Monitor, secure, and troubleshoot the Service, including detecting and preventing fraud, abuse, and unauthorized access.",
        "Analyze usage to improve reliability, performance, and product design.",
        "Comply with legal obligations and enforce our Terms of Service.",
        "Send marketing communications where permitted, from which you may unsubscribe at any time.",
      ],
      "We do not use your content, connected-source data, or Output to train foundation models for general use, and we do not sell personal information.",
    ],
  },
  {
    heading: "AI processing",
    summary: "How your data is handled when automated systems assist you.",
    body: [
      "To power features such as summaries, classification, extraction, search, and drafting, relevant content is processed by large language models and related automated systems operating on your behalf.",
      "We minimize what is sent for each task, sending only the context needed rather than your entire history, and we redact sensitive values where feasible. Model providers act as our service providers under contract and are prohibited from using your data to train their models.",
      "Automated systems assist your decisions rather than replace them. Oppulence prepares work for your approval and does not make decisions that produce legal or similarly significant effects about you. Output may be inaccurate, and you remain responsible for reviewing it before acting.",
      "Where you enable meeting capture, recording and transcription may involve third-party speech providers. Recording laws vary by jurisdiction, and you are responsible for obtaining any consent required from meeting participants.",
    ],
  },
  {
    heading: "Google user data",
    body: [
      "Oppulence's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
      "We use Google user data only to provide and improve user-facing features of the Service. We do not sell it, do not use it for advertising, and do not use it to develop, improve, or train generalized AI or machine learning models. We do not allow humans to read your Google data except with your explicit consent for specific messages, where necessary for security purposes such as investigating abuse, to comply with applicable law, or where the data has been aggregated and anonymized.",
      "You can revoke Oppulence's access at any time through your Google account permissions page or by disconnecting the account in the Service.",
    ],
  },
  {
    heading: "How we share personal information",
    body: [
      "We do not sell personal information, and we do not share it for cross-context behavioral advertising. We disclose it only as follows:",
      [
        {
          term: "Service providers",
          text: "Vendors that host infrastructure, store and index data, process payments, provide model inference and transcription, send email, and provide product analytics and error monitoring, each under contract limiting their use to providing services to us.",
        },
        {
          term: "Connected services you authorize",
          text: "Platforms you connect, to read the data you approve and to write back actions you approve.",
        },
        {
          term: "Within your organization",
          text: "Where you use a shared workspace, your content and activity may be visible to other members and administrators of that workspace according to its permissions.",
        },
        {
          term: "Professional advisers and authorities",
          text: "Lawyers, auditors, and insurers, and law enforcement or regulators where required by law or valid legal process, or to protect the rights, safety, and integrity of Oppulence, our users, or the public.",
        },
        {
          term: "Business transfers",
          text: "In connection with a merger, acquisition, financing, reorganization, or sale of assets, subject to this Policy or a successor policy with equivalent protections.",
        },
      ],
    ],
  },
  {
    heading: "Data retention",
    body: [
      "We retain personal information for as long as your account is active and as needed to provide the Service. Retention periods are based on how long is required to fulfil the purposes described in this Policy, plus any period required to comply with legal obligations, resolve disputes, and enforce agreements.",
      "You can delete content in the Service at any time. When you disconnect a source, we stop syncing new data; previously synced data is deleted according to your workspace settings or on request.",
      "When you delete your account, we delete or de-identify associated personal information within 30 days, except where we must retain it for legal, tax, security, or dispute-resolution reasons. Backups are purged on a rolling schedule.",
    ],
  },
  {
    heading: "Security",
    body: [
      "We employ technical, organizational, and physical safeguards designed to protect personal information, including encryption in transit, encryption at rest for sensitive stored credentials and tokens, scoped access to connected sources, role-based access controls, audit logging, and least-privilege access for our personnel.",
      "Security risk is inherent in all internet and information technologies, and we cannot guarantee absolute security. If you believe you have found a vulnerability, please report it under our Responsible Disclosure Policy rather than disclosing it publicly.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      [
        {
          term: "Access and control in-product",
          text: "You can view, edit, export, and delete much of your content directly in the Service, manage workspace members, and connect or disconnect sources at any time.",
        },
        {
          term: "Marketing communications",
          text: "You can unsubscribe from marketing email using the link in any such message. We will still send transactional and service messages.",
        },
        {
          term: "Cookies and tracking",
          text: "You can block or delete cookies in your browser settings, subject to the limits described above.",
        },
        {
          term: "Do Not Track and Global Privacy Control",
          text: "We honor Global Privacy Control signals as opt-out requests where applicable law requires. Because we do not sell or share personal information for advertising, the practical effect is limited.",
        },
      ],
    ],
  },
  {
    heading: "Other sites and services",
    body: [
      "The Service may link to or integrate with websites and services operated by third parties. These links are not endorsements. We do not control third-party services and are not responsible for their practices. We encourage you to read their privacy policies.",
    ],
  },
  {
    heading: "International data transfers",
    body: [
      "We are headquartered in the United States and use service providers that operate in the United States and other countries. Your personal information may be transferred to and processed in jurisdictions whose privacy laws differ from those where you live.",
      "Where we transfer personal information out of Europe to a country without an adequacy decision, we rely on appropriate safeguards, including the European Commission's Standard Contractual Clauses and the UK International Data Transfer Addendum, together with supplementary technical and organizational measures. You may request a copy of the relevant safeguards by contacting us.",
    ],
  },
  {
    heading: "Children",
    body: [
      "The Service is not intended for anyone under 18, and we do not knowingly collect personal information from children. If you believe a child has provided us personal information, contact privacy@oppulence.io and we will take appropriate steps to delete it.",
    ],
  },
  {
    heading: "State privacy rights notice",
    summary:
      "For residents of U.S. states with comprehensive privacy laws, including California, Colorado, Connecticut, Virginia, Texas, Oregon, Montana, Utah, Iowa, Indiana, and Tennessee.",
    body: [
      "Subject to applicable law and to verification, you may have the right to:",
      [
        {
          term: "Know and access",
          text: "Request the categories and specific pieces of personal information we have collected, the sources, the business purposes, and the categories of third parties to whom we disclose it, and obtain a copy.",
        },
        {
          term: "Correct",
          text: "Ask us to correct inaccurate personal information we maintain about you.",
        },
        {
          term: "Delete",
          text: "Ask us to delete personal information we collected from you, subject to legal exceptions.",
        },
        {
          term: "Portability",
          text: "Receive a copy in a portable, machine-readable format where technically feasible.",
        },
        {
          term: "Opt out",
          text: "Opt out of the sale or sharing of personal information, targeted advertising, and profiling with legal or similarly significant effects. We do not sell or share personal information for targeted advertising, and we do not conduct such profiling.",
        },
        {
          term: "Appeal",
          text: "Appeal a denial of any request. Submit appeals to privacy@oppulence.io with the original request reference.",
        },
        {
          term: "Non-discrimination",
          text: "Exercise these rights without discriminatory treatment.",
        },
      ],
      "To exercise these rights, email privacy@oppulence.io from the address associated with your account. We may need to verify your identity before responding, and we may ask for additional information where a request is unclear or where we cannot confirm your identity. An authorized agent may submit a request on your behalf with proof of authority.",
      "Sensitive personal information. We do not process sensitive personal information for the purpose of inferring characteristics about you.",
      "Where you use Oppulence through your employer's workspace, we generally act as a service provider or processor on your employer's behalf. In that case, please direct your request to your employer, and we will assist them in responding.",
      "California Shine the Light. California residents may request the categories of personal information disclosed to third parties for their direct marketing purposes. We do not make such disclosures. Send any request labeled “Shine the Light Request” to privacy@oppulence.io.",
    ],
  },
  {
    heading: "Notice to European users",
    summary: "Applies to individuals in the EEA, the UK, and Switzerland.",
    body: [
      "Controller and processor. Where we determine the purposes and means of processing — for example, for account administration, billing, security, and our own marketing — Playbook Media, Inc. is the controller. Where we process data from your connected sources on your instructions, we generally act as a processor on behalf of you or your organization, which is the controller.",
      "Legal bases. We rely on the following legal bases under the GDPR and UK GDPR:",
      [
        {
          term: "Performance of a contract",
          text: "To provide the Service, administer your account, and process payments.",
        },
        {
          term: "Legitimate interests",
          text: "To secure the Service, prevent fraud and abuse, analyze and improve our product, and conduct business-to-business marketing, balanced against your rights.",
        },
        {
          term: "Consent",
          text: "For connecting third-party sources, enabling meeting capture, and any optional processing where consent is required. You may withdraw consent at any time without affecting prior processing.",
        },
        {
          term: "Legal obligation",
          text: "To comply with tax, accounting, and other legal requirements, and to respond to valid legal process.",
        },
      ],
      "Your rights. Subject to applicable law, you have the rights of access, rectification, erasure, restriction of processing, data portability, and objection to processing based on legitimate interests, including objection to direct marketing at any time. You also have the right to lodge a complaint with your local supervisory authority, and in the UK with the Information Commissioner's Office.",
      "Automated decision-making. We do not make decisions producing legal or similarly significant effects about you based solely on automated processing.",
      "Retention and transfers are described in the Data retention and International data transfers sections above.",
    ],
  },
  {
    heading: "Changes to this Privacy Policy",
    body: [
      "We may modify this Privacy Policy at any time. If we make material changes, we will notify you by updating the effective date and posting the revised Policy in the Service, and where appropriate by email. Your use of the Service after the effective date indicates that the modified Policy applies.",
    ],
  },
  {
    heading: "How to contact us",
    body: [
      "For privacy questions or to exercise your rights, contact us at privacy@oppulence.io. For legal notices, contact legal@oppulence.io. To report a security vulnerability, follow our Responsible Disclosure Policy at /responsible-disclosure.",
      "Playbook Media, Inc. · Oppulence",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      contactEmail="privacy@oppulence.io"
      effective={EFFECTIVE}
      intro="Your data stays yours. This Policy describes what we collect, why we collect it, who we share it with, how long we keep it, and the controls you have."
      lastUpdated={LAST_UPDATED}
      related={[
        { label: "Terms of Service", href: "/terms" },
        { label: "Responsible disclosure", href: "/responsible-disclosure" },
      ]}
      sections={SECTIONS}
      title="Privacy Policy"
    />
  );
}
