# Deploying the KEN E-TEST feature upgrade

This package is an application upgrade, not a database reset.

## Existing live deployment

1. **Back up the live MySQL database first.** Export the complete `ken_etest` database from your database host/provider. Do not skip this step.
2. Open the SQL console for the database used by the live application and run `database/upgrade_v2.sql` exactly once. The script adds the matriculation-number column, exam scheduling columns and support-ticket table; it preserves existing exam questions, student records, results and sessions. It also adds three presentation accounts.
3. Deploy the updated application files from this package to the same service/repository used by the existing live deployment. Keep the existing database environment variables, service settings, start command and domain unchanged.
4. Restart/redeploy the web service and open `/api` to confirm the database reports as connected.
5. Test admin login, student login with a matriculation number, student registration from the admin panel, exam scheduling, deactivation, and a support ticket before presenting it.

**Never import `database/ken_etest.sql` into the existing live database.** That file is the fresh-install/reset script and drops/recreates tables. For the live deployment use only `database/upgrade_v2.sql`, once.

## Fresh installation

For a genuinely empty database, import `database/ken_etest.sql` and deploy the application. Do not run `upgrade_v2.sql` after importing the fresh-install SQL because the new schema is already included there.

## Demonstration accounts

Admin: `admin` / `Admin@123`.

The three presentation student accounts are:

- `DEMO/2026/001` / `Student@123`
- `DEMO/2026/002` / `Student@123`
- `DEMO/2026/003` / `Student@123`

Students created from Admin → Students receive their matriculation number as the initial password. The student can change it after logging in. Existing accounts keep their existing password during the migration.
