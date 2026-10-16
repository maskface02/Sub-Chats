# Branch source coordinates

`0002_branch_sources` adds three nullable columns. Existing chats and messages
are preserved, and older application versions can ignore these columns.

The local PGlite bootstrap applies the same idempotent additions. PostgreSQL
deployments must run `npm run db:migrate` before deploying the updated app.

Rollback: deploy the previous application version and leave the nullable
columns in place. Do not drop them: that would lose the saved locations.
Older branches without coordinates are highlighted only when their selected
text has exactly one matching occurrence across their parent's assistant messages.
