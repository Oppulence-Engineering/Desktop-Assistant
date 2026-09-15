/**
 * The desktop side of account deletion (the `account:delete` IPC channel).
 *
 * The API call and the local sign-out are injected, so the flow can be tested
 * without Electron, the network, or the token store.
 */
interface AccountDeletionSteps {
  /** DELETE /v1/me. Rejects when the API refuses or cannot be reached. */
  deleteAccount: () => Promise<void>;
  /** Clears the local session of the deleted identity. */
  clearSession: () => Promise<unknown>;
  /** Reads the API problem code out of a failure, or null. */
  problemCode: (error: unknown) => string | null;
}

interface AccountDeletionResult {
  success: boolean;
  code: string | null;
}

export async function runAccountDeletion(
  steps: AccountDeletionSteps,
): Promise<AccountDeletionResult> {
  try {
    await steps.deleteAccount();
  } catch (error) {
    // The account still exists: keep the session so the user can retry.
    return { success: false, code: steps.problemCode(error) };
  }
  try {
    await steps.clearSession();
  } catch (error) {
    // The server already deleted the account. A local sign-out failure must not
    // tell the user that the deletion failed.
    console.warn("[Account] Local sign-out after account deletion failed:", error);
  }
  return { success: true, code: null };
}
