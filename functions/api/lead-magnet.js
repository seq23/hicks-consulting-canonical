import { handleFormRequestGet, handleFormRequestPost } from './_lib/form-database.js';

const FORM_TYPE = 'lead-magnet';

export async function onRequestPost({ request, env }) {
  return handleFormRequestPost({ request, env, formType: FORM_TYPE });
}

export async function onRequestGet() {
  return handleFormRequestGet();
}
