# Mirage mail

The wheel contains Mirage's IMAP and SMTP handlers compiled from `integ/server/mail/arms.ts` at revision `b8a3422d28f2fecf32ccb0ff9e7bd87317e4bad1`, plus the SQL generated from that commit's `integ/prisma/mail.prisma`. The adjacent license covers the Mirage sources. The Python launcher installs the npm lock through the packaged Node runtime. One process serves one isolated trial database. SMTP delivers only to accounts seeded on its simulated domain.

Regenerate the handlers and schema with `scripts/datasets/toolathlon/build_mail_mock.py --mirage CHECKOUT --esbuild ESBUILD --prisma PRISMA`, using esbuild 0.28.2 and Mirage's Prisma 6 CLI.
