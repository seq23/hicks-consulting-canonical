# Digital Products Admin Runbook

## Purpose

Manage Hicks Consulting free downloads and premium Gumroad downloads without redesigning the current Resources system.

## Public Routes

- `/resources/free-downloads/` lists published free downloads.
- `/resources/premium-downloads/` lists published premium downloads.
- `/resources/` keeps the current page style and expands the resource cards to a 3x2 grid.

## Admin Route

Use `/admin/digitalproducts/`. The design intentionally follows the current `/admin/` panels, tables, typography, colors, and operator instructions.

## Free Download Flow

1. Choose Free Download.
2. Enter title, description, category, and status.
3. Upload PDF.
4. Optionally upload a cover image.
5. If no cover image is uploaded, the product card uses the uploaded PDF first-page preview.
6. Publish only when ready.

## Premium Download Flow

1. Choose Premium Download.
2. Enter title, description, category, price, and Gumroad URL.
3. Optionally upload a PDF for internal/archive use after Cloudflare R2 is configured.
4. Optionally upload a cover image.
5. If no cover image is uploaded and a PDF is available, the product card uses the uploaded PDF first-page preview.
6. Adding a Gumroad link makes the product ready; it does not automatically publish.
7. Publish only after final human review.

## Cloudflare Bindings Needed Later

- `DIGITAL_PRODUCTS_KV`: KV namespace for product metadata.
- `DIGITAL_PRODUCT_FILES`: R2 bucket for uploaded PDFs and covers.
- `DIGITAL_PRODUCTS_ADMIN_TOKEN`: write token required by admin API mutations.
- Optional `DIGITAL_PRODUCT_FILES_PUBLIC_BASE_URL`: public R2/custom-domain base URL for uploaded files.

## Placeholder Rule

`https://www.gumroad.com` is allowed only for draft or ready products. Published premium products may not use the placeholder URL.
