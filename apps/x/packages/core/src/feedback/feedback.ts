import { getAccessToken } from "../auth/tokens.js";
import { API_URL } from "../config/env.js";

export interface FeedbackSubmission {
  category: string;
  message: string;
  appVersion: string;
  platform: string;
}

/**
 * Relay a feedback submission to the backend, which forwards it to Plain.
 * Requires a signed-in account (getAccessToken throws when signed out).
 */
export async function submitFeedback(input: FeedbackSubmission): Promise<void> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${API_URL}/v1/feedback`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Feedback API failed: ${response.status}`);
  }
}
