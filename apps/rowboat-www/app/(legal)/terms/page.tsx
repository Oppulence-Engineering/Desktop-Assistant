import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service — Oppulence",
  description: "The terms that govern your access to and use of Oppulence.",
};

const EFFECTIVE = "September 8, 2026";
const LAST_UPDATED = "September 8, 2026";

const SECTIONS: LegalSection[] = [
  {
    heading: "Acceptance of these Terms",
    body: [
      "Oppulence (the “Service”) is owned and operated by Playbook Media, Inc. (“Oppulence,” “Company,” “we,” “us,” or “our”). The Service includes our website, web console, desktop application, APIs, connectors, and related services.",
      "These Terms of Service (the “Terms”) govern your access to and use of the Service. By creating an account, clicking a button indicating acceptance, or otherwise using the Service, you agree to these Terms. If you are agreeing on behalf of a company or other legal entity, you represent that you have authority to bind that entity, and “you” refers to that entity. You must be at least 18 years old to use the Service.",
      {
        callout:
          "PLEASE READ THE DISPUTE RESOLUTION SECTION CAREFULLY. It requires disputes to be resolved through binding individual arbitration instead of in court, and it waives your rights to a jury trial and to participate in a class action. You may opt out within 30 days as described in that section.",
      },
    ],
  },
  {
    heading: "The Service",
    summary: "What Oppulence does, and what it does not do on its own.",
    body: [
      "Oppulence maintains a living model of your customer relationships. It reads across the sources you connect — such as email, calendar, meetings, Slack, and CRM — to show what changed, what needs attention, and the evidence behind each recommendation, and to prepare next actions for your review.",
      "Oppulence prepares work for approval. Except where you explicitly configure and authorize an automated action, the Service does not send external communications or write to your connected systems without a confirmation step you control. You remain responsible for everything you approve, send, or act on.",
      "We may add, change, or remove features, and may impose limits on certain features or restrict access to parts of the Service. We have no obligation to provide support or maintenance except as separately agreed in writing.",
    ],
  },
  {
    heading: "Accounts and account security",
    body: [
      "You sign in through a supported identity provider, such as Google. You agree to provide accurate and complete registration information and to keep it current. You are responsible for keeping your credentials confidential and for all activity that occurs under your account.",
      "Notify us promptly at security@oppulence.io if you believe your account has been accessed without authorization. We are not liable for losses arising from your failure to safeguard your credentials.",
      "If you use the Service as part of an organization's workspace, the organization's administrators may access, control, restrict, or delete your account and its contents.",
    ],
  },
  {
    heading: "License and restrictions",
    body: [
      "Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your internal business purposes. All rights not expressly granted are reserved.",
      "You may not:",
      [
        "License, sell, rent, lease, transfer, assign, or commercially exploit the Service or its content, except as expressly permitted.",
        "Modify, create derivative works from, disassemble, reverse-compile, or reverse-engineer any part of the Service, except to the extent this restriction is prohibited by applicable law.",
        "Access the Service in order to build a similar or competing product or service, or to benchmark it for a competitor.",
        "Use the Service to violate any law or third-party right, including sending communications that are unlawful, deceptive, harassing, or that violate anti-spam laws such as the CAN-SPAM Act.",
        "Upload or transmit malicious code, or attempt to gain unauthorized access to the Service, other accounts, or connected systems.",
        "Interfere with or disrupt the integrity or performance of the Service, including through excessive automated requests or denial-of-service activity.",
        "Process data you do not have the right to process, or use the Service in a way that violates the terms of a system you connect.",
      ],
    ],
  },
  {
    heading: "Connected accounts and third-party services",
    body: [
      "The Service connects to third-party accounts and platforms that you authorize, such as email, calendar, meeting, messaging, and CRM providers (“Connected Services”). You are responsible for the accounts you connect and for confirming you have the right to grant Oppulence access to the associated data, including data about third parties such as your customers and colleagues.",
      "Your use of a Connected Service is governed by that provider's own terms and privacy practices. We do not control Connected Services and are not responsible for their acts or omissions, availability, or changes to their APIs. You may disconnect a Connected Service at any time within the Service.",
      "We access Connected Service data only to provide the features you use, as described in our Privacy Policy.",
    ],
  },
  {
    heading: "AI output and your responsibility to review",
    summary: "Automated systems assist you. They do not replace your judgment.",
    body: [
      "The Service uses automated systems, including large language models operated by us and by third-party providers, to generate summaries, classifications, extractions, drafts, and suggested actions (“Output”).",
      "Output may be inaccurate, incomplete, out of date, or unsuitable for your purpose, and similar prompts may produce different results for different users. You are solely responsible for reviewing Output before relying on it, sending it, or otherwise acting on it, and for ensuring that your use complies with applicable law and with the policies of your organization and your customers.",
      "Do not use the Service as the sole basis for decisions that require professional judgment, including legal, financial, medical, or employment decisions.",
      "As between you and us, and to the extent permitted by law, you own the Output generated for you from your data. Output is not unique, and we may generate similar output for other users.",
    ],
  },
  {
    heading: "Your data",
    body: [
      "As between you and Oppulence, you retain all right, title, and interest in the data you provide, connect, or generate through the Service (“Your Data”). We claim no ownership of Your Data.",
      "You grant us a limited, worldwide, non-exclusive license to host, copy, transmit, display, and process Your Data solely to provide, secure, and support the Service, and as otherwise directed by you. We handle Your Data in accordance with our Privacy Policy.",
      "You are responsible for the accuracy and legality of Your Data and for obtaining any consents or providing any notices required for us to process it on your behalf, including where Your Data includes personal information about third parties.",
      "You are responsible for maintaining your own copies of anything you need to retain. The Service is not a system of record or a backup service.",
    ],
  },
  {
    heading: "Feedback",
    body: [
      "If you send us feedback, suggestions, or ideas about the Service, you grant us a perpetual, irrevocable, worldwide, non-exclusive, fully paid, royalty-free license to use them for any purpose without restriction, attribution, or compensation. Please do not send feedback you consider confidential or proprietary.",
    ],
  },
  {
    heading: "Fees, billing, and refunds",
    body: [
      "Paid plans are billed through our payment processor on the terms presented at purchase. You authorize recurring charges to your payment method until you cancel, and you are responsible for all applicable taxes other than taxes on our net income.",
      "Fees are non-refundable except where required by law or as we decide in our sole discretion. Cancelling or downgrading does not entitle you to a refund of amounts already paid, including for the unused portion of a billing period.",
      "Overdue amounts may result in suspension of the Service. We may change pricing prospectively with at least 30 days' notice; continued use after the change takes effect constitutes acceptance.",
      "Usage-based features, including AI processing and connector activity, may be metered. Where limits apply, they are described in your plan.",
    ],
  },
  {
    heading: "Intellectual property",
    body: [
      "The Service, including its software, models, design, documentation, and content (excluding Your Data and Output), is owned by Oppulence and its licensors and is protected by copyright, trademark, patent, and trade secret laws. These Terms grant you no ownership rights in the Service.",
      "All trademarks, logos, and service marks displayed on the Service are owned by Oppulence or third parties, and may not be used without prior written consent from the owner.",
    ],
  },
  {
    heading: "Indemnification",
    body: [
      "You agree to defend, indemnify, and hold harmless Oppulence and its officers, directors, employees, and agents from any claims, damages, and reasonable costs and attorneys' fees arising out of (i) your use of the Service, (ii) Your Data or your Connected Services, (iii) your violation of these Terms, or (iv) your violation of any applicable law or third-party right.",
      "We may assume control of the defense of any such claim at your expense, and you agree to cooperate. You may not settle a claim in a way that imposes obligations on us without our prior written consent. We will make reasonable efforts to notify you promptly of a claim we become aware of.",
    ],
  },
  {
    heading: "Disclaimers",
    body: [
      {
        callout:
          "THE SERVICE AND ALL OUTPUT ARE PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE FULLEST EXTENT PERMITTED BY LAW, OPPULENCE AND ITS SUPPLIERS DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT ANY OUTPUT WILL BE ACCURATE, COMPLETE, OR RELIABLE.",
      },
      "Some jurisdictions do not allow the exclusion of implied warranties, so parts of this section may not apply to you. Where applicable law requires warranties, they are limited to 90 days from your first use of the Service.",
    ],
  },
  {
    heading: "Limitation of liability",
    body: [
      {
        callout:
          "TO THE MAXIMUM EXTENT PERMITTED BY LAW: (A) OPPULENCE AND ITS SUPPLIERS WILL NOT BE LIABLE FOR ANY LOST PROFITS, LOST REVENUE, LOST DATA, LOSS OF GOODWILL, COSTS OF SUBSTITUTE SERVICES, OR ANY INDIRECT, CONSEQUENTIAL, INCIDENTAL, SPECIAL, EXEMPLARY, OR PUNITIVE DAMAGES ARISING FROM OR RELATED TO THESE TERMS OR THE SERVICE; AND (B) OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS IS CAPPED AT THE GREATER OF (i) ONE HUNDRED U.S. DOLLARS ($100) AND (ii) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM.",
      },
      "These limitations apply regardless of the theory of liability and even if we have been advised of the possibility of such damages. The existence of multiple claims does not increase this cap. Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.",
    ],
  },
  {
    heading: "Term, suspension, and termination",
    body: [
      "These Terms remain in effect while you use the Service. You may stop using the Service and delete your account at any time.",
      "We may suspend or terminate your access, including deleting your account, if you breach these Terms, if your use creates risk or legal exposure for us or others, for non-payment, or as required by law. Where practical, we will provide notice.",
      "Upon termination, your right to use the Service ends. We will make Your Data available for a reasonable period so you can export it, after which it may be deleted in accordance with our Privacy Policy and retention practices. Sections covering restrictions, ownership, feedback, your data, indemnification, disclaimers, limitation of liability, dispute resolution, and general provisions survive termination.",
    ],
  },
  {
    heading: "Compliance and export controls",
    body: [
      "You agree to comply with all applicable laws, including U.S. export control and sanctions laws. You represent that you are not located in, and are not a national or resident of, a country subject to comprehensive U.S. sanctions, and that you are not on any restricted-party list.",
    ],
  },
  {
    heading: "State-specific notices",
    summary: "These provisions apply only to the extent you are subject to the laws named.",
    body: [
      [
        {
          term: "California",
          text: "Under California Civil Code Section 1789.3, the provider of the Service is Playbook Media, Inc. To file a complaint or request further information, contact legal@oppulence.io. You may also contact the Complaint Assistance Unit of the Division of Consumer Services of the California Department of Consumer Affairs at 1625 N. Market Blvd., Suite N112, Sacramento, CA 95834, or (800) 952-5210. California residents may have additional rights under the CCPA as amended by the CPRA; see our Privacy Policy.",
        },
        {
          term: "Colorado, Connecticut, and Virginia",
          text: "Residents may have rights of access, correction, deletion, and portability, and rights to opt out of targeted advertising, sale of personal data, and certain profiling, under the CPA, CTDPA, and VCDPA respectively. See our Privacy Policy for how to exercise them.",
        },
        {
          term: "Nevada",
          text: "Under Nevada Revised Statutes Chapter 603A, Nevada residents may direct us not to sell certain information we have collected about them. We do not sell personal information, but you may submit a request to privacy@oppulence.io.",
        },
        {
          term: "Other states",
          text: "Residents of other states with comprehensive privacy laws, including Texas, Oregon, Montana, Utah, Iowa, Indiana, and Tennessee, may have similar rights. See our Privacy Policy.",
        },
      ],
    ],
  },
  {
    heading: "Dispute resolution and arbitration",
    summary: "This section affects your legal rights, including your right to sue in court.",
    body: [
      {
        callout:
          "BY AGREEING TO ARBITRATION, YOU AND OPPULENCE WAIVE THE RIGHT TO A TRIAL BY JUDGE OR JURY, AND WAIVE THE RIGHT TO BRING OR PARTICIPATE IN A CLASS, REPRESENTATIVE, OR COLLECTIVE PROCEEDING.",
      },
      [
        {
          term: "Scope",
          text: "Except as described below, you and Oppulence agree to resolve all disputes arising out of or relating to the Service or these Terms through binding individual arbitration, including disputes that arose before you accepted these Terms. Excluded are claims that qualify for small claims court brought on an individual basis, and requests for injunctive or equitable relief to protect intellectual property.",
        },
        {
          term: "Informal resolution first",
          text: "Before starting arbitration, the party raising the dispute must send written notice to the other. Notice to us goes to legal@oppulence.io. Within 45 days of that notice the parties will confer in good faith by phone or video. If the dispute is not resolved within 60 days, either party may begin arbitration.",
        },
        {
          term: "Rules and forum",
          text: "Arbitration is administered by JAMS under its rules — the Streamlined Arbitration Rules for claims under $250,000 and the Comprehensive Arbitration Rules for larger claims. Unless the parties agree otherwise, arbitration takes place in the county where you reside, and all materials remain confidential.",
        },
        {
          term: "Authority of the arbitrator",
          text: "The arbitrator decides all arbitrable disputes, including the scope and enforceability of this agreement, except that courts decide challenges to the class action waiver, disputes about arbitration fees, whether a condition precedent was satisfied, and which version of this agreement applies. The arbitrator may award the same relief as a court, on an individual basis only, and the award is final and binding.",
        },
        {
          term: "Fees and batching",
          text: "Each party bears its own attorneys' fees unless the arbitrator finds a claim frivolous or brought for an improper purpose. If 100 or more substantially similar demands are filed within a 30-day period by the same firm or coordinated group, JAMS will batch them into groups of 100 with one arbitrator and one set of fees per batch.",
        },
        {
          term: "How to opt out",
          text: "You may opt out of this arbitration agreement within 30 days of first accepting these Terms by emailing legal@oppulence.io with your name, the email address on your account, and a clear statement that you wish to opt out. Opting out does not affect any other part of these Terms.",
        },
        {
          term: "Severability",
          text: "If any part of this arbitration agreement is found invalid, it will be modified to the minimum extent necessary to be enforceable and the rest remains in effect. If the class action waiver is found unenforceable as to a specific claim, that claim may proceed in court while all other claims remain in arbitration.",
        },
      ],
    ],
  },
  {
    heading: "General provisions",
    body: [
      [
        {
          term: "Changes to these Terms",
          text: "We may update these Terms. If changes are material, we will provide at least 30 days' notice by email or a prominent notice in the Service before they take effect. Continued use after that means you accept the updated Terms.",
        },
        {
          term: "Governing law and venue",
          text: "These Terms are governed by the laws of the State of Delaware, without regard to conflict-of-law principles. For claims not subject to arbitration, the parties consent to the exclusive jurisdiction of the state and federal courts located in Delaware, except that either party may seek injunctive relief to protect intellectual property in any court of competent jurisdiction, and either party may bring an individual small claims action.",
        },
        {
          term: "Electronic communications",
          text: "By using the Service you consent to receive communications from us electronically, by email or by notice posted in the Service. Electronic communications satisfy any legal requirement that a notice be in writing.",
        },
        {
          term: "Accessibility",
          text: "We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA. If you have difficulty accessing any part of the Service, contact accessibility@oppulence.io and we will make reasonable efforts to address the issue.",
        },
        {
          term: "Force majeure",
          text: "Neither party is liable for delays or failures caused by circumstances beyond its reasonable control, including outages at Connected Services or third-party model providers.",
        },
        {
          term: "Assignment and entire agreement",
          text: "You may not assign these Terms without our prior written consent; we may assign them freely, including in connection with a merger or sale of assets. These Terms, together with the Privacy Policy and any referenced policies, are the entire agreement between you and Oppulence regarding the Service. If a provision is found unenforceable, it will be modified to the minimum extent necessary and the rest remains in effect. Our failure to enforce a provision is not a waiver. “Including” means “including without limitation.”",
        },
      ],
    ],
  },
  {
    heading: "Contact",
    body: [
      "Questions about these Terms can be sent to legal@oppulence.io. Security reports should follow our Responsible Disclosure Policy at /responsible-disclosure. Privacy requests can be sent to privacy@oppulence.io.",
      "Playbook Media, Inc. · Oppulence",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      contactEmail="legal@oppulence.io"
      effective={EFFECTIVE}
      intro="These Terms explain the rules for using Oppulence: what the Service does, what you are responsible for, and how disputes are resolved. Please read them carefully, particularly the sections on AI output and dispute resolution."
      lastUpdated={LAST_UPDATED}
      related={[
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Responsible disclosure", href: "/responsible-disclosure" },
      ]}
      sections={SECTIONS}
      title="Terms of Service"
    />
  );
}
