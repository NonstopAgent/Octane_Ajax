#!/usr/bin/env node
/**
 * Backup setup for the product_pdfs bucket when SQL migration cannot run storage DDL.
 * Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in the environment.
 *
 * Usage: node scripts/setup-product-pdfs-bucket.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = "product_pdfs";

const { data: existing, error: listError } = await supabase.storage.listBuckets();
if (listError) {
  console.error("listBuckets failed:", listError.message);
  process.exit(1);
}

if (existing?.some((b) => b.id === BUCKET)) {
  console.log(`Bucket "${BUCKET}" already exists.`);
  process.exit(0);
}

const { error: createError } = await supabase.storage.createBucket(BUCKET, {
  public: false,
  fileSizeLimit: 10 * 1024 * 1024,
  allowedMimeTypes: ["application/pdf"],
});

if (createError) {
  console.error("createBucket failed:", createError.message);
  console.error(
    "Apply supabase/migrations/20260518120000_product_pdfs_storage.sql in the SQL Editor instead.",
  );
  process.exit(1);
}

console.log(`Created private bucket "${BUCKET}" (10MB, application/pdf only).`);
console.log(
  "Still apply the migration for storage.objects RLS policies (user-scoped paths).",
);
