-- Shop map position for the website's "shops near you" list.
ALTER TABLE "shops" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
