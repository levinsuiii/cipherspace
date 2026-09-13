# Legal configuration checklist

This repository provides a technical legal-page baseline, not a guarantee of legal compliance.
Complete and verify every item below before a public release:

- [x] Operator's full legal name entered: `Levin Strecke`.
- [x] Operator's serviceable postal address entered: `Nikolaus-Becker-Straße 1, 55131 Mainz`.
- [x] Monitored privacy/legal contact address entered: `levin.strecke@yahoo.de`.
- [ ] Verify and execute an appropriate Cloudflare data processing agreement (DPA/AVV).
- [ ] Verify and execute an appropriate Render data processing agreement (DPA/AVV).
- [ ] Verify and execute an appropriate Neon data processing agreement (DPA/AVV).
- [ ] Verify and execute an appropriate Resend data processing agreement (DPA/AVV).
- [ ] Verify the actual Cloudflare, Render, Neon and Resend hosting/database processing regions.
- [ ] Verify and document any required international-transfer safeguards for every provider.
- [ ] Reconfirm before release and after dependency/configuration changes that no non-essential analytics, advertising or tracking technology is active.
- [ ] Confirm that the service remains free; revise the terms before introducing payment or subscriptions.
- [ ] Define and review operational retention periods for accounts, sessions, verification challenges, logs, soft-deleted notes, comment metadata and backups.
- [ ] Define and test an operational process for access, correction, export and deletion requests sent to the legal contact address.
- [ ] Check whether any additional mandatory operator disclosures apply to the individual operator.
- [ ] Obtain professional legal review before a commercial or public-scale launch.

## Repository storage/tracking scan

The scan for this baseline found **no non-essential tracking technology** in application source or declared runtime dependencies. No analytics, advertising, marketing pixels or third-party tracking SDKs were found. The application uses a necessary HTTP-only authentication cookie, a necessary `localStorage` offline-profile cache, IndexedDB for encrypted/local/offline application data and protected key material, and a service-worker cache for the application shell. `sessionStorage` is not used by application code.

This is a repository finding, not proof of the deployed configuration. Recheck provider dashboards, injected scripts, DNS/proxy features and the deployed response before release; those external systems were intentionally not accessed for this task.
