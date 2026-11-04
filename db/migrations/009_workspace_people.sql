-- Identity for records: current members plus anyone who ever acted in the workspace,
-- so approvals and audit entries keep their verified email after offboarding.
-- Display names are user-editable; emails cannot be changed in this application.
CREATE FUNCTION app.workspace_people(p_workspace uuid)
RETURNS TABLE(user_id text,name text,email text,current_member boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
BEGIN
 IF app.role_for(p_workspace) IS NULL OR app.active_workspace() IS DISTINCT FROM p_workspace THEN
 RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT u.id,u.name,u.email,EXISTS(SELECT 1 FROM app.workspace_membership m
 WHERE m.workspace_id=p_workspace AND m.user_id=u.id)
 FROM public."user" u WHERE u.id IN (
 SELECT m.user_id FROM app.workspace_membership m WHERE m.workspace_id=p_workspace
 UNION SELECT e.actor_id FROM app.audit_event e WHERE e.workspace_id=p_workspace);
END $$;
REVOKE ALL ON FUNCTION app.workspace_people(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.workspace_people(uuid) TO companyos_app;
