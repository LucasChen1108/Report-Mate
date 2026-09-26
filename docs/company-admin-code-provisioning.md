# Company Admin Code Provisioning Guide

## Purpose

Report Mate requires a company authorization code before someone can register
an Admin account. This prevents the public registration page from granting
Admin access based only on a role selected in the browser.

Company Admin codes are provisioned by a trusted operator. They are not created
through a public API or the Report Mate user interface. After the first Admin
has registered, that Admin can generate Worker join codes through the Worker
Management page.

This guide explains how to create demonstration companies and Admin codes in
the AWS Lightsail PostgreSQL database.

## Security model

- The raw Admin code is shown only when it is generated.
- PostgreSQL stores a SHA-256 hash of the code, not the raw value.
- Registration hashes the submitted code and looks up the matching database
  record.
- A code can be limited by expiry time and maximum number of uses.
- A code can be revoked before it expires.
- Losing the raw value does not expose it from the database; generate a new code
  instead.

Never place raw codes, database passwords, or database connection strings in
Git, migrations, screenshots, issue trackers, or public team channels.

## Prerequisites

Before continuing, confirm that:

1. The Report Mate backend has connected to the target database at least once
   and successfully applied its migrations.
2. PostgreSQL contains the `companies` and `company_admin_codes` tables.
3. The `pgcrypto` extension is installed. Report Mate's migration stream
   installs it automatically.
4. You can connect to the Lightsail database using pgAdmin, `psql`, or another
   trusted PostgreSQL client.
5. You are operating on the intended demo database, not an unrelated database.

## Get the Lightsail connection details

1. Sign in to the AWS Lightsail console.
2. Open **Databases**.
3. Select the Report Mate PostgreSQL database.
4. Open the **Connect** tab.
5. Copy the endpoint, port, username, password, and primary database name.
6. Connect with pgAdmin or another PostgreSQL client.

PostgreSQL normally uses port `5432`.

If connecting from a developer computer, the database must be reachable from
that computer. Lightsail Public mode may need to be enabled temporarily under
the database's **Networking** tab. Disable it again when external access is no
longer required.

## Step 1: Create or update the demonstration company

Choose one exact company name for the demonstration. Admins and Workers must
enter a company name that normalizes to the same value during registration.

The example below uses `Report Mate Demo`:

```sql
INSERT INTO companies (id, name, normalized_name)
VALUES (
    gen_random_uuid(),
    'Report Mate Demo',
    'report mate demo'
)
ON CONFLICT (normalized_name)
DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = now()
RETURNING id, name, normalized_name;
```

The `normalized_name` must be lowercase, trimmed, and use single spaces between
words. Keep the display name and normalized name logically equivalent.

This statement is safe to rerun for the same normalized company name. It
returns the existing company after updating its display name.

## Step 2: Generate a company Admin code

The following statement generates a cryptographically random code, stores only
its hash, permits up to five successful Admin registrations, and expires after
one day:

```sql
WITH generated AS (
    SELECT
        gen_random_uuid() AS id,
        'ADMIN-' || upper(encode(gen_random_bytes(20), 'hex')) AS raw_code
),
created AS (
    INSERT INTO company_admin_codes (
        id,
        company_id,
        code_hash,
        max_uses,
        expires_at
    )
    SELECT
        generated.id,
        companies.id,
        digest(generated.raw_code, 'sha256'),
        5,
        now() + interval '1 day'
    FROM generated
    JOIN companies
      ON companies.normalized_name = 'report mate demo'
    RETURNING id, max_uses, used_count, expires_at
)
SELECT
    created.id AS code_id,
    generated.raw_code,
    created.max_uses,
    created.used_count,
    created.expires_at
FROM created
JOIN generated USING (id);
```

The result contains:

- `code_id`: the database identifier used for auditing or revocation.
- `raw_code`: the value entered on the registration page.
- `max_uses`: the maximum number of successful registrations.
- `used_count`: the number of successful registrations so far.
- `expires_at`: the time after which registration rejects the code.

Copy the `raw_code` immediately and share it only with the intended demo
participants through an appropriate private channel. It will look similar to:

```text
ADMIN-8D17B5F4A61A0E43C225E307B91969308DA1587C
```

The example code above is illustrative and is not a usable authorization code.

### Single-use code

For a code that creates exactly one Admin account, change:

```sql
5,
```

to:

```sql
1,
```

in the value inserted into `max_uses`.

Single-use codes are preferred when each teammate can receive a separate code.

### Different expiry period

Change:

```sql
now() + interval '1 day'
```

to another short period, such as:

```sql
now() + interval '4 hours'
```

or:

```sql
now() + interval '7 days'
```

Avoid issuing long-lived demonstration codes unless they are necessary.

## Step 3: Register the Admin account

On the Report Mate registration page:

1. Select **Admin**.
2. Enter the company as `Report Mate Demo`.
3. Enter the raw code in the **Company Admin Code** field.
4. Complete the remaining registration fields.
5. Submit the form.

The backend performs the following work in one database transaction:

1. Hashes the submitted code.
2. Locks and reads the matching authorization-code record.
3. Checks expiry, revocation, company matching, and remaining uses.
4. Creates the Admin account and both login email identities.
5. Increments the code's `used_count`.
6. Creates the initial login session.
7. Commits everything together.

If any step fails, the transaction rolls back and the code is not consumed.

## Step 4: Inspect code status

Use this query to review issued codes without exposing raw values:

```sql
SELECT
    code.id,
    company.name AS company_name,
    code.max_uses,
    code.used_count,
    code.expires_at,
    code.revoked_at,
    code.created_at
FROM company_admin_codes AS code
JOIN companies AS company
  ON company.id = code.company_id
ORDER BY code.created_at DESC;
```

A code is usable only when all of the following are true:

- `revoked_at` is `NULL`.
- `expires_at` is still in the future.
- `used_count` is less than `max_uses`.
- The registration company matches the code's company.

## Step 5: Revoke a code

Use the `code_id` returned during generation or found in the status query:

```sql
UPDATE company_admin_codes
SET
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE id = '<code-id>'
RETURNING id, revoked_at;
```

Replace `<code-id>` with the real UUID. Revocation prevents future use but does
not delete Admin accounts that were already created.

## Step 6: Generate Worker join codes

Company Admin codes and Worker join codes have different purposes:

- A company Admin code creates an Admin account for a company.
- A Worker join code creates a Worker linked directly to the Admin who issued
  it.

After an Admin has registered and signed in:

1. Open the **Workers** page.
2. Generate a Worker join code.
3. Copy the raw value shown by the application.
4. Send it privately to the intended Worker.
5. Revoke unused codes when they are no longer needed.

Worker codes do not need to be generated manually in PostgreSQL.

## Troubleshooting

### Registration says the code is invalid

- Confirm the full raw code was copied without additional characters.
- Codes are matched by their exact trimmed value and are case-sensitive.
- Confirm the code was generated in the database used by the running backend.

### Registration says the company does not match

- Confirm the user entered the intended company name.
- Check the company record's `normalized_name`.
- Normalization lowercases the value, trims surrounding whitespace, and
  replaces repeated internal whitespace with a single space.

### Registration says the code has already been used

- Check whether `used_count` has reached `max_uses`.
- Generate a new code rather than modifying historical usage.

### Registration says the code expired or was revoked

- Inspect `expires_at` and `revoked_at` using the status query.
- Generate a new short-lived code when appropriate.

### The generation query returns no rows

The company lookup did not find this normalized name:

```text
report mate demo
```

Run the company-creation query first, or update the generation query to use the
correct normalized company name.

### `gen_random_bytes` or `digest` does not exist

Confirm that the production migrations ran successfully and that PostgreSQL's
`pgcrypto` extension is installed:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Run extension installation only with an appropriately privileged database
account.

## Demonstration checklist

Before the demonstration:

- [ ] Confirm the backend points to the intended demo database.
- [ ] Confirm the demonstration company exists.
- [ ] Generate only the number of Admin codes needed.
- [ ] Use a short expiry period.
- [ ] Test one Admin registration and login.
- [ ] Confirm the Admin can generate a Worker join code.
- [ ] Test one Worker registration and login.
- [ ] Confirm the Worker cannot access Admin-only routes.
- [ ] Revoke unused Admin and Worker codes after the demonstration.
- [ ] Disable Lightsail Public mode if it is no longer required.

## Recommended future improvement

The repository already contains secure code-generation and hashing primitives,
but it does not yet provide a production operator command for company and Admin
code provisioning. A future operator-only CLI should:

1. Accept a company name, expiry, and maximum use count.
2. Create or select the company.
3. Generate the raw code with the existing Go security package.
4. store only the hash through the accounts repository.
5. print the raw value exactly once.
6. refuse unsafe defaults and avoid logging database credentials.

Until that command exists, the SQL workflow in this guide is the supported
manual demonstration process.
