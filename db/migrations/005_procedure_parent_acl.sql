-- Determine the real latest version outside RLS; otherwise its invisibility
-- could cause a policy subquery to fall back to an older readable publication.
CREATE FUNCTION app.procedure_readable(p_workspace uuid,p_procedure uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.version_readable(p_workspace,(SELECT id FROM app.procedure_version
 WHERE workspace_id=p_workspace AND procedure_id=p_procedure ORDER BY version DESC LIMIT 1))
$$;
DROP POLICY procedure_read ON app.procedure;
CREATE POLICY procedure_read ON app.procedure FOR SELECT TO companyos_app USING(app.procedure_readable(workspace_id,id));
REVOKE ALL ON FUNCTION app.procedure_readable(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.procedure_readable(uuid,uuid) TO companyos_app;

