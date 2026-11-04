-- Parent titles track the latest publication; hide restricted newer titles.
DROP POLICY procedure_read ON app.procedure;
CREATE POLICY procedure_read ON app.procedure FOR SELECT TO companyos_app USING(
 app.version_readable(workspace_id,(SELECT v.id FROM app.procedure_version v
 WHERE v.procedure_id=app.procedure.id ORDER BY v.version DESC LIMIT 1))
);
