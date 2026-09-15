/**
 * The message the settings dialog shows when the API refuses to delete an
 * account. The API returns a problem code; the user needs an action, not the
 * code.
 */
export function accountDeletionErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "workspace_successor_required":
      return "Your workspace has other members and none of them can take ownership. Remove the other members first, then delete your account.";
    case "billing_cancellation_failed":
      return "We could not cancel your subscription, so your account was not deleted. Try again, or contact support.";
    default:
      return "We could not delete your account. Try again, or contact support.";
  }
}
