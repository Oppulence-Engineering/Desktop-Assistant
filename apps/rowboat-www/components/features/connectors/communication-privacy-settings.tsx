"use client";

import "client-only";

import * as React from "react";

import { Button } from "@oppulence/ui/components/button";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import { Input } from "@oppulence/ui/components/input";
import { Label } from "@oppulence/ui/components/label";

import {
  createCommunicationPrivacyRule,
  deleteCommunicationPrivacyRule,
  getCommunicationPolicy,
  listCommunicationPrivacyRules,
  putCommunicationPolicy,
} from "@/lib/revenue";
import type { CommunicationPolicy, CommunicationPrivacyRule } from "@/types/revenue";

export function CommunicationPrivacySettings() {
  const [accountId, setAccountId] = React.useState("");
  const [policy, setPolicy] = React.useState<CommunicationPolicy | null>(null);
  const [rules, setRules] = React.useState<CommunicationPrivacyRule[]>([]);
  const [ruleKind, setRuleKind] = React.useState("protected_address");
  const [ruleValue, setRuleValue] = React.useState("");
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async (sourceAccountId: string) => {
    if (!sourceAccountId.trim()) return;
    const [nextPolicy, nextRules] = await Promise.all([
      getCommunicationPolicy(sourceAccountId.trim()),
      listCommunicationPrivacyRules(),
    ]);
    setPolicy(nextPolicy);
    setRules(nextRules);
  }, []);

  React.useEffect(() => {
    if (!accountId.trim()) return;
    void refresh(accountId).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Could not load mailbox policy.");
    });
  }, [accountId, refresh]);

  async function savePolicy() {
    if (!policy || !accountId.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const saved = await putCommunicationPolicy(accountId.trim(), policy);
      setPolicy(saved);
      setStatus("Mailbox policy saved.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Could not save mailbox policy.");
    } finally {
      setBusy(false);
    }
  }

  async function addRule() {
    if (!ruleValue.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await createCommunicationPrivacyRule({ kind: ruleKind, value: ruleValue.trim() });
      setRuleValue("");
      await refresh(accountId);
      setStatus("Privacy rule added.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Could not add privacy rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-stack" data-slot="communication-privacy-settings">
      <div className="settings-row">
        <div className="settings-row-copy">
          <p className="settings-row-label">Mailbox account</p>
          <p className="settings-row-description">
            Configure privacy defaults for one connected Google mailbox.
          </p>
        </div>
        <Input
          aria-label="Mailbox account email"
          className="settings-input"
          onChange={(event) => setAccountId(event.target.value)}
          placeholder="you@company.com"
          value={accountId}
        />
      </div>

      {policy ? (
        <>
          <div className="settings-row">
            <Label className="settings-row-label" htmlFor="metadata-visibility">
              Metadata visibility
            </Label>
            <select
              className="settings-input"
              id="metadata-visibility"
              onChange={(event) => setPolicy({ ...policy, metadataVisibility: event.target.value })}
              value={policy.metadataVisibility}
            >
              <option value="workspace">Workspace-visible metadata</option>
              <option value="private">Private metadata</option>
            </select>
          </div>
          <div className="settings-row">
            <Checkbox
              checked={policy.shareSubject}
              id="share-subject"
              onCheckedChange={(checked) =>
                setPolicy({ ...policy, shareSubject: checked === true })
              }
            />
            <Label htmlFor="share-subject">Share subject lines by default</Label>
          </div>
          <div className="settings-row">
            <Checkbox
              checked={policy.shareBody}
              id="share-body"
              onCheckedChange={(checked) => setPolicy({ ...policy, shareBody: checked === true })}
            />
            <Label htmlFor="share-body">Share bodies by default</Label>
          </div>
          <div className="settings-row">
            <Checkbox
              checked={policy.shareAttachments}
              id="share-attachments"
              onCheckedChange={(checked) =>
                setPolicy({ ...policy, shareAttachments: checked === true })
              }
            />
            <Label htmlFor="share-attachments">Share attachments by default</Label>
          </div>
          <div className="settings-row">
            <Button disabled={busy} onClick={() => void savePolicy()} type="button">
              Save mailbox policy
            </Button>
          </div>
        </>
      ) : null}

      <div className="settings-row">
        <div className="settings-row-copy">
          <p className="settings-row-label">Protected or blocked addresses</p>
          <p className="settings-row-description">
            Protected recipients stay owner-only. Blocked addresses never project into the
            workspace.
          </p>
        </div>
        <div className="settings-inline-controls">
          <select
            aria-label="Privacy rule kind"
            className="settings-input"
            onChange={(event) => setRuleKind(event.target.value)}
            value={ruleKind}
          >
            <option value="protected_address">Protected address</option>
            <option value="protected_domain">Protected domain</option>
            <option value="blocked_address">Blocked address</option>
            <option value="blocked_domain">Blocked domain</option>
          </select>
          <Input
            aria-label="Privacy rule value"
            onChange={(event) => setRuleValue(event.target.value)}
            placeholder="buyer@example.com"
            value={ruleValue}
          />
          <Button disabled={busy} onClick={() => void addRule()} type="button" variant="outline">
            Add rule
          </Button>
        </div>
      </div>

      {rules.length > 0 ? (
        <ul className="settings-list">
          {rules.map((rule) => (
            <li className="settings-list-item" key={rule.id}>
              <span>
                {rule.kind}: {rule.value}
              </span>
              <Button
                disabled={busy}
                onClick={() =>
                  void deleteCommunicationPrivacyRule(rule.id).then(() => refresh(accountId))
                }
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {status ? <p className="settings-inline-notice">{status}</p> : null}
    </div>
  );
}
