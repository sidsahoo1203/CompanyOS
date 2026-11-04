-- Offboarding: remove a member (or leave) with immediate, fail-closed effects.
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_action_check;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_action_check CHECK(action IN (
 'workspace.created','workspace.updated','member.invited','member.joined','member.role_changed','member.removed',
 'knowledge.created','knowledge.updated','document.uploaded','document.processed','document.accessed','knowledge.searched',
 'procedure.published','skill.created','skill.toggled','run.created','run.finished',
 'approval.requested','approval.edited','approval.approved','approval.rejected','approval.expired','approval.denied',
 'action.executed'
));
CREATE FUNCTION app.remove_member(p_workspace uuid,p_user text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor text; v_target text; v_id uuid;
BEGIN
 IF p_workspace IS DISTINCT FROM app.active_workspace() THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 v_actor:=app.role_for(p_workspace);
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
 SELECT role INTO v_target FROM app.workspace_membership WHERE workspace_id=p_workspace AND user_id=p_user FOR UPDATE;
 IF v_target IS NULL THEN RAISE EXCEPTION 'Member unavailable' USING ERRCODE='P0002'; END IF;
 IF v_target='owner' THEN RAISE EXCEPTION 'The owner cannot be removed' USING ERRCODE='42501'; END IF;
 -- Mirrors invitations: the owner removes anyone else, admins remove members, anyone may leave.
 IF p_user IS DISTINCT FROM app.actor_id() AND NOT (v_actor='owner' OR (v_actor='admin' AND v_target='member')) THEN
 RAISE EXCEPTION 'Removal permission required' USING ERRCODE='42501'; END IF;
 DELETE FROM app.workspace_membership WHERE workspace_id=p_workspace AND user_id=p_user;
 -- Pending requests they asked for or wrote can no longer be approved.
 FOR v_id IN UPDATE app.approval_request SET status='expired'
 WHERE workspace_id=p_workspace AND status='pending' AND (requested_by=p_user OR authored_by=p_user) RETURNING id LOOP
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,metadata)
 VALUES(p_workspace,app.actor_id(),'approval.expired',v_id::text,jsonb_build_object('reason','member_removed'));
 END LOOP;
 -- Invitation links they issued stop working (acceptance also rechecks the issuer).
 UPDATE app.invitation SET expires_at=now() WHERE workspace_id=p_workspace AND invited_by=p_user AND accepted_at IS NULL AND expires_at>now();
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk,metadata)
 VALUES(p_workspace,app.actor_id(),'member.removed',p_user,'medium',
 jsonb_build_object('previousRole',v_target,'self',p_user=app.actor_id()));
END $$;
REVOKE ALL ON FUNCTION app.remove_member(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.remove_member(uuid,text) TO companyos_app;
