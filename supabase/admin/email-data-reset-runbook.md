# FLUXO Email data reset runbook

This runbook deletes FLUXO database records only. It does not call Gmail, alter
the mailbox, disconnect the account, or read, update, or delete OAuth or Vault
secrets.

## Preview phase

1. Open the SQL Editor for project `jhbpgdpllwligclpalsj`.
2. Run statement 1 in `email-data-reset-preview.sql` and identify exactly one
   connected Google account. Do not guess either UUID.
3. Replace both zero UUIDs in statement 2 with that row's account and
   organization UUIDs.
4. Run statement 2 only. Review all counts. Cleanup requires both
   `other_email_accounts_in_organization` and
   `inconsistent_target_message_links` to be zero.
5. Stop here until the preview has been explicitly approved.

## Cleanup phase (only after separate approval)

1. Keep every FLUXO Communications page closed for the maintenance window.
2. Find the scheduled sync job:

   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname = 'fluxo-gmail-sync-every-five-minutes';
   ```

3. Pause the job using the reviewed `jobid`:

   ```sql
   select cron.alter_job(<reviewed_jobid>, active := false);
   ```

4. Verify `active = false` with the query from step 2, then wait at least five
   minutes for an already-started HTTP sync invocation to finish.
5. Run the scoped preview statement again and confirm that its target and counts
   have not changed unexpectedly.
6. In `email-data-reset-cleanup.sql`, replace both zero UUIDs and set the exact
   confirmation text to `RESET FLUXO EMAIL DATA <target_email_account_id>`.
7. Run the complete cleanup script once. Its transaction commits only if every
   scope, cascade, preservation, and post-delete assertion passes. A SQL error
   aborts the transaction.
8. Verify the result with the same scoped preview: all three removal counts and
   `target_account_message_links` must be zero; the account must remain
   `connected`; `sync_cursor`, `last_sync_at`, and `last_error` must be null;
   non-email counts must match the approved preview.
9. Resume the reviewed cron job:

   ```sql
   select cron.alter_job(<reviewed_jobid>, active := true);
   ```

10. Verify `active = true`, then open Communications once to allow the bounded
    initial sync to repopulate only messages accepted by the current filter.

If the cron job does not exist, do not create one as part of this cleanup. Skip
the pause/resume statements, keep Communications closed, and verify there is no
other scheduler invoking `email-sync` before proceeding.
