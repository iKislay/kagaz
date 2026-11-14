-- Shop address comes from the location captured in the Kaggaz Shop app (never typed); null until then.
ALTER TABLE "shops" ALTER COLUMN "address" DROP NOT NULL;

-- First-run setup in the Kaggaz Shop app.
ALTER TABLE "shops" ADD COLUMN "onboarded_at" TIMESTAMP(3);
