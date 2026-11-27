-- CreateTable
CREATE TABLE "MailMailbox" (
    "tenant" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uidNext" INTEGER NOT NULL DEFAULT 1,
    "uidValidity" INTEGER NOT NULL DEFAULT 1,
    "seq" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("tenant", "name")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "tenant" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "internalDate" BIGINT NOT NULL,
    "flags" TEXT NOT NULL DEFAULT '',
    "source" BLOB NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("tenant", "mailbox", "uid")
);

-- CreateIndex
CREATE INDEX "MailMessage_tenant_mailbox_idx" ON "MailMessage"("tenant", "mailbox");
