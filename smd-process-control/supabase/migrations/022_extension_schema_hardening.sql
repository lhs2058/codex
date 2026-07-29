-- Keep extension-owned objects outside the API-exposed public schema.
alter extension btree_gist set schema extensions;
