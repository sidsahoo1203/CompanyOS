-- 006 line 64 stored this character class as literal invisible characters, which
-- reviewers cannot see. Redefine it with ASCII escapes; matching is unchanged.
CREATE OR REPLACE FUNCTION app.approval_text_safe(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p_value !~ (E'[\\u0001-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]')
$$;
REVOKE ALL ON FUNCTION app.approval_text_safe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.approval_text_safe(text) TO companyos_app;
